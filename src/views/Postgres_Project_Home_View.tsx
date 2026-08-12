import {
  type ComponentType,
  type Dispatch,
  type SetStateAction,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile as readTauriFile, writeFile } from "@tauri-apps/plugin-fs";
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
import { formatCurrentDateTime } from "../i18n/formatters";
import {
  createPostgresProjectUser,
  createPostgresObjectAttributeDefinition,
  createPostgresRelationshipAttributeDefinition,
  deletePostgresObject,
  deletePostgresObjectType,
  deletePostgresProjectUser,
  deletePostgresRelationship,
  deletePostgresRelationshipType,
  deletePostgresSavedDrawing,
  getPostgresProjectCanvasState,
  getPostgresSavedDrawing,
  importPostgresObjectImage,
  importPostgresObjectTypeImage,
  listPostgresAppUsers,
  listPostgresObjects,
  listPostgresObjectAttributeDefinitions,
  listPostgresObjectTypes,
  listPostgresProjectUsers,
  listPostgresRelationshipAttributeDefinitions,
  listPostgresRelationships,
  listPostgresRelationshipTypes,
  listPostgresSavedDrawingSummaries,
  listPostgresSources,
  savePostgresObject,
  savePostgresObjectType,
  savePostgresProjectCanvasState,
  savePostgresRelationship,
  savePostgresRelationshipType,
  savePostgresSavedDrawing,
  removePostgresObjectImage,
  removePostgresObjectTypeImage,
  updatePostgresProjectUser,
  updatePostgresRelationshipAttributeDefinition,
  type PostgresAppUser,
  type PostgresAuthSession,
  type PostgresCanvasDisplayShape,
  type PostgresCanvasNodeState,
  type PostgresCanvasPoint,
  type PostgresCanvasShape,
  type PostgresObject,
  type PostgresObjectAttributeDefinition,
  type PostgresObjectType,
  type PostgresProject,
  type PostgresProjectChangeEvent,
  type PostgresProjectUser,
  type PostgresRelationship,
  type PostgresRelationshipAttributeDefinition,
  type PostgresRelationshipType,
  type PostgresSavedDrawing,
  type PostgresSavedDrawingSummary,
  type PostgresSource,
  POSTGRES_PROJECT_CHANGED_EVENT,
} from "../lib/postgres";
import {
  AttributeValuesModal,
  type SharedAttributeDraft,
} from "../components/AttributeValuesModal";
import {
  PostgresAttributeValueHistoryModal,
  type PostgresAttributeValueHistoryTarget,
} from "../components/PostgresAttributeValueHistoryModal";
import { AttributeDefinitionModal } from "../components/AttributeDefinitionModal";
import {
  PostgresRelationshipModal,
  type PostgresRelationshipEndpointOption as SharedPostgresRelationshipEndpointOption,
} from "../components/PostgresRelationshipModal";
import sidebarMarkLogo from "../assets/logo-mark-no-background.png";
import sidebarLogo from "../assets/logo-no-background.png";
import type { PostgresMemoDraftTarget } from "./Postgres_Project_Memos_View";

function normalizeCanvasSvgTextHtml(html: string): string {
  const trimmed = html.trim();
  return trimmed ? html : "<div>Text</div>";
}

const PostgresAppSettingsViewLazy = lazy(
  () => import("./Postgres_App_Settings_View").then((m) => ({ default: m.PostgresAppSettingsView })),
);
const PostgresUserSettingsViewLazy = lazy(
  () => import("./Postgres_User_Settings_View").then((m) => ({ default: m.PostgresUserSettingsView })),
);
const PostgresProjectSettingsViewLazy = lazy(
  () => import("./Postgres_Project_Settings_View").then((m) => ({ default: m.PostgresProjectSettingsView })),
);
const PostgresProjectSourcesViewLazy = lazy(
  () => import("./Postgres_Project_Sources_View").then((m) => ({ default: m.PostgresProjectSourcesView })),
);
const PostgresAnalysisCodeSourcesViewLazy = lazy(
  () => import("./Postgres_Analysis_Code_Sources_View").then((m) => ({ default: m.PostgresAnalysisCodeSourcesView })),
);
const PostgresAiAssistAssistedCodingViewLazy = lazy(
  () => import("./Postgres_AIAssist_Assisted_Coding_View").then((m) => ({ default: m.PostgresAiAssistAssistedCodingView })),
);
const PostgresFreeDrawCanvasViewLazy = lazy(
  () => import("./Postgres_Free_Draw_Canvas_View").then((m) => ({ default: m.PostgresCanvasView })),
);
const PostgresExploreCanvasViewLazy = lazy(
  () => import("./Postgres_Explore_Canvas_View").then((m) => ({ default: m.PostgresExploreCanvasView })),
);
const PostgresProjectMemosViewLazy = lazy(
  () => import("./Postgres_Project_Memos_View").then((m) => ({ default: m.PostgresProjectMemosView })),
);
const PostgresReportsViewLazy = lazy(
  () => import("./Postgres_Reports_View").then((m) => ({ default: m.PostgresReportsView })),
);
const PostgresProjectLogViewLazy = lazy(
  () => import("./Postgres_Project_Log_View").then((m) => ({ default: m.PostgresProjectLogView })),
);
const PostgresAiAssistHomeViewLazy = lazy(
  () => import("./Postgres_AIAssist_Home_View").then((m) => ({ default: m.PostgresAiAssistHomeView })),
);
const PostgresAiAssistChatViewLazy = lazy(
  () => import("./Postgres_AIAssist_Chat_View").then((m) => ({ default: m.PostgresAiAssistChatView })),
);
const PostgresAiAssistAnalyzeViewLazy = lazy(
  () => import("./Postgres_AIAssist_Analyze_View").then((m) => ({ default: m.PostgresAIAssistAnalyzeView })),
);
const PostgresAiAssistAttributesViewLazy = lazy(
  () => import("./Postgres_AIAssist_Attributes_View").then((m) => ({ default: m.PostgresAIAssistAttributesView })),
);
const PostgresAiAssistProcessSourcesViewLazy = lazy(
  () => import("./Postgres_AIAssist_ProcessSources_View").then((m) => ({ default: m.PostgresAiAssistProcessSourcesView })),
);
const CodebookViewLazy = lazy(
  () => import("./Project_Codebook_View").then((m) => ({
    default: m.CodebookView as ComponentType<import("./Project_Codebook_View").CodebookViewProps>,
  })),
);
const AnnotationsViewLazy = lazy(
  () => import("./Project_Annotations_View").then((m) => ({
    default: m.AnnotationsView as ComponentType<import("./Project_Annotations_View").AnnotationsViewProps>,
  })),
);

export type PostgresProjectHomeViewProps = {
  project: PostgresProject;
  authSession: PostgresAuthSession;
  onAuthSessionUpdated: (session: PostgresAuthSession) => void;
  onAuthSessionInvalidated: () => void;
  onBack: () => void;
  onProjectUpdated: (project: PostgresProject) => void;
  onProjectDeleted: (projectId: string) => void;
  onSignOut: () => Promise<void>;
};

type PostgresObjectTypeShape =
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
type PostgresSourceObjectVisualKey =
  | "source_text"
  | "source_processed_transcript"
  | "source_pdf"
  | "source_image"
  | "source_audio"
  | "source_video";
type PostgresObjectFill = "filled" | "outline";
type PostgresObjectGraphicMode = "select" | "upload";
type PostgresObjectInstanceGraphicMode = "inherit" | "select" | "upload";
type PostgresRelationshipLineShape = "solid" | "dashed" | "dotted";
type PostgresRelationshipArrowhead = "one_sided" | "double_sided" | "none";
type PostgresProjectScreen =
  | "home"
  | "users"
  | "sources"
  | "annotations"
  | "codebook"
  | "code-text"
  | "memos"
  | "reports"
  | "project-log"
  | "objects"
  | "relationships"
  | "free-draw"
  | "explore"
  | "construct"
  | "view"
  | "ai-assist"
  | "ai-assist-chat"
  | "ai-assisted-coding"
  | "ai-analyze"
  | "ai-assist-source-attributes"
  | "ai-assist-object-attributes"
  | "ai-assist-process-documents"
  | "app-settings"
  | "project-settings"
  | "user-settings";

function PostgresAiAssistPortPlaceholderView({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="view home-view ai-assist-home-view">
      <header className="view-header">
        <div>
          <h1>{title}</h1>
          <p className="view-subtitle">{detail}</p>
        </div>
      </header>
      <section className="home-project-card ai-assist-home-card">
        <div className="home-project-card-header">
          <h2>PostgreSQL Port</h2>
        </div>
        <p className="home-project-description">
          This destination is available in the PostgreSQL project shell and is ready for the next AI Assist view port.
        </p>
      </section>
    </div>
  );
}
type PostgresObjectTypeSortCol = "objectType" | "count";
type PostgresRelationshipAttributeDraft = SharedAttributeDraft;
type TypeAttributeDraft = SharedAttributeDraft & { localId: string };
type TypeScopedAttributeDraft = SharedAttributeDraft & { typeIds: string[] };
type PostgresRelationshipEndpointOption = SharedPostgresRelationshipEndpointOption & {
  key: string;
  entityType: "object" | "source";
  entityId: string;
  name: string;
  type: string;
};
type PostgresCanvasTool = "select" | "hand" | "connect" | "pen" | "shape" | "text" | "eraser";
type PostgresImageUploadDraft = {
  originalFileName: string;
  fileBytesBase64: string;
  previewUrl: string;
  fileSizeBytes: number;
};
type PostgresImageCropAspect = "original" | "1:1" | "4:3" | "16:9";
type PostgresImageCropDraft = {
  upload: PostgresImageUploadDraft;
  mode: "full" | "crop";
  aspect: PostgresImageCropAspect;
  sizePercent: number;
  xPercent: number;
  yPercent: number;
  error: string;
};
type PostgresImageCropResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
type PostgresImageCropDragState = {
  mode: "move" | "resize";
  handle?: PostgresImageCropResizeHandle;
  startClientX: number;
  startClientY: number;
  startSizePercent: number;
  startXPercent: number;
  startYPercent: number;
  imageWidth: number;
  imageHeight: number;
  displayScale: number;
};

const POSTGRES_OBJECT_TYPE_DEFAULT_COLOR = "#355070";
const POSTGRES_RELATIONSHIP_DEFAULT_COLOR = "#355070";
const POSTGRES_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const POSTGRES_OBJECT_TYPE_SHAPE_OPTIONS: { value: PostgresObjectTypeShape; label: string }[] = [
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
const POSTGRES_OBJECT_FILL_OPTIONS: { value: PostgresObjectFill; label: string }[] = [
  { value: "filled", label: "Filled" },
  { value: "outline", label: "Outline" },
];
const POSTGRES_RELATIONSHIP_LINE_SHAPE_OPTIONS: { value: PostgresRelationshipLineShape; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
];
const POSTGRES_RELATIONSHIP_LINE_WEIGHT_OPTIONS = [
  { value: 1, label: "Thin" },
  { value: 2, label: "Regular" },
  { value: 3, label: "Bold" },
  { value: 4, label: "Heavy" },
] as const;
const POSTGRES_RELATIONSHIP_ARROWHEAD_OPTIONS: { value: PostgresRelationshipArrowhead; label: string }[] = [
  { value: "one_sided", label: "One-sided" },
  { value: "double_sided", label: "Double-sided" },
  { value: "none", label: "No arrows" },
];
const POSTGRES_SOURCE_KIND_OPTIONS: Array<{
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
  return `data:image/svg+xml;utf8,${encodeURIComponent(svgMarkup)}`;
}

const POSTGRES_OBJECT_SHAPE_ASSET_URLS: Record<
  PostgresObjectTypeShape,
  { filled: string; outline: string }
> = {
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
const POSTGRES_SOURCE_OBJECT_SHAPE_ASSET_URLS: Record<
  PostgresSourceObjectVisualKey,
  string
> = {
  source_text: buildSvgDataUrl(sourceTextOutlineShapeSvg),
  source_processed_transcript: buildSvgDataUrl(sourceProcessedTranscriptOutlineShapeSvg),
  source_pdf: buildSvgDataUrl(sourcePdfOutlineShapeSvg),
  source_image: buildSvgDataUrl(sourceImageOutlineShapeSvg),
  source_audio: buildSvgDataUrl(sourceAudioOutlineShapeSvg),
  source_video: buildSvgDataUrl(sourceVideoOutlineShapeSvg),
};

function isPostgresSourceObjectVisualKey(
  value: string | null | undefined,
): value is PostgresSourceObjectVisualKey {
  return value === "source_text"
    || value === "source_processed_transcript"
    || value === "source_pdf"
    || value === "source_image"
    || value === "source_audio"
    || value === "source_video";
}

function getPostgresSourceObjectVisualKey(
  systemKey: string | null | undefined,
): PostgresSourceObjectVisualKey | null {
  return isPostgresSourceObjectVisualKey(systemKey) ? systemKey : null;
}

function normalizePostgresObjectTypeShape(value: string): PostgresObjectTypeShape {
  const normalized = value.trim().toLowerCase();
  if (normalized === "pill" || normalized === "circle") {
    return "rounded";
  }
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

function normalizePostgresRelationshipLineShape(value: string): PostgresRelationshipLineShape {
  const normalized = value.trim().toLowerCase();
  if (normalized === "dashed" || normalized === "dotted") return normalized;
  return "solid";
}

function normalizePostgresRelationshipLineWeight(value: number | null | undefined): number {
  if (value === 1 || value === 3 || value === 4) return value;
  return 2;
}

function normalizePostgresRelationshipArrowhead(value: string): PostgresRelationshipArrowhead {
  const normalized = value.trim().toLowerCase();
  if (normalized === "double_sided" || normalized === "none") return normalized;
  return "one_sided";
}

function normalizePostgresObjectTypeColor(value: string): string {
  const normalized = value.trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : POSTGRES_OBJECT_TYPE_DEFAULT_COLOR;
}

function normalizePostgresObjectFill(value: string): PostgresObjectFill {
  return value.trim().toLowerCase() === "outline" ? "outline" : "filled";
}

function normalizeOptionalPostgresObjectTypeColor(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : "";
}

function normalizePostgresRelationshipColor(value: string): string {
  const normalized = value.trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : POSTGRES_RELATIONSHIP_DEFAULT_COLOR;
}

function normalizeOptionalPostgresRelationshipColor(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : "";
}

function resolvePostgresObjectShape(
  object: Pick<PostgresObject, "shapeOverride">,
  objectTypeRecord: Pick<PostgresObjectType, "shape"> | null,
): PostgresObjectTypeShape {
  return normalizePostgresObjectTypeShape(object.shapeOverride || objectTypeRecord?.shape || "");
}

function resolvePostgresObjectColor(
  object: Pick<PostgresObject, "colorOverride">,
  objectTypeRecord: Pick<PostgresObjectType, "color"> | null,
): string {
  return normalizePostgresObjectTypeColor(object.colorOverride || objectTypeRecord?.color || "");
}

function resolvePostgresObjectFill(
  object: Pick<PostgresObject, "fillOverride">,
  objectTypeRecord: Pick<PostgresObjectType, "fill"> | null,
): PostgresObjectFill {
  return normalizePostgresObjectFill(object.fillOverride || objectTypeRecord?.fill || "");
}

function getPostgresObjectAppearance(
  object: Pick<PostgresObject, "shapeOverride" | "colorOverride" | "fillOverride" | "imageStoragePath">,
  objectTypeRecord: Pick<PostgresObjectType, "shape" | "color" | "fill" | "systemKey" | "imageStoragePath"> | null,
): {
  shape: PostgresObjectTypeShape;
  color: string;
  fill: PostgresObjectFill;
  imageStoragePath: string;
  sourceVisualKey: PostgresSourceObjectVisualKey | null;
  hasShapeOverride: boolean;
  hasColorOverride: boolean;
  hasFillOverride: boolean;
} {
  return {
    shape: resolvePostgresObjectShape(object, objectTypeRecord),
    color: resolvePostgresObjectColor(object, objectTypeRecord),
    fill: resolvePostgresObjectFill(object, objectTypeRecord),
    imageStoragePath: object.imageStoragePath || objectTypeRecord?.imageStoragePath || "",
    sourceVisualKey: getPostgresSourceObjectVisualKey(objectTypeRecord?.systemKey),
    hasShapeOverride: !!object.shapeOverride.trim(),
    hasColorOverride: !!object.colorOverride.trim(),
    hasFillOverride: !!object.fillOverride.trim(),
  };
}

function formatPostgresObjectShapeLabel(shape: PostgresObjectTypeShape): string {
  return POSTGRES_OBJECT_TYPE_SHAPE_OPTIONS.find((option) => option.value === shape)?.label ?? "Circle";
}

function formatPostgresObjectFillLabel(fill: PostgresObjectFill): string {
  return POSTGRES_OBJECT_FILL_OPTIONS.find((option) => option.value === fill)?.label ?? "Filled";
}

function resolvePostgresRelationshipLineShape(
  relationship: Pick<PostgresRelationship, "lineShapeOverride">,
  relationshipTypeRecord: Pick<PostgresRelationshipType, "lineShape"> | null,
): PostgresRelationshipLineShape {
  return normalizePostgresRelationshipLineShape(
    relationship.lineShapeOverride || relationshipTypeRecord?.lineShape || "",
  );
}

function resolvePostgresRelationshipColor(
  relationship: Pick<PostgresRelationship, "colorOverride">,
  relationshipTypeRecord: Pick<PostgresRelationshipType, "color"> | null,
): string {
  return normalizePostgresRelationshipColor(
    relationship.colorOverride || relationshipTypeRecord?.color || "",
  );
}

function resolvePostgresRelationshipLineWeight(
  relationship: Pick<PostgresRelationship, "lineWeightOverride">,
  relationshipTypeRecord: Pick<PostgresRelationshipType, "lineWeight"> | null,
): number {
  return normalizePostgresRelationshipLineWeight(
    relationship.lineWeightOverride ?? relationshipTypeRecord?.lineWeight,
  );
}

function resolvePostgresRelationshipArrowhead(
  relationship: Pick<PostgresRelationship, "arrowheadOverride">,
  relationshipTypeRecord: Pick<PostgresRelationshipType, "arrowhead"> | null,
): PostgresRelationshipArrowhead {
  return normalizePostgresRelationshipArrowhead(
    relationship.arrowheadOverride || relationshipTypeRecord?.arrowhead || "",
  );
}

function getPostgresRelationshipAppearance(
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

function formatPostgresRelationshipLineShapeLabel(lineShape: PostgresRelationshipLineShape): string {
  return POSTGRES_RELATIONSHIP_LINE_SHAPE_OPTIONS.find((option) => option.value === lineShape)?.label ?? "Solid";
}

function formatPostgresRelationshipLineWeightLabel(lineWeight: number): string {
  return POSTGRES_RELATIONSHIP_LINE_WEIGHT_OPTIONS.find((option) => option.value === lineWeight)?.label ?? "Regular";
}

function formatPostgresRelationshipArrowheadLabel(arrowhead: PostgresRelationshipArrowhead): string {
  return POSTGRES_RELATIONSHIP_ARROWHEAD_OPTIONS.find((option) => option.value === arrowhead)?.label ?? "One-sided";
}

function getPostgresRelationshipStrokeWidth(lineWeight: number): number {
  const normalized = normalizePostgresRelationshipLineWeight(lineWeight);
  if (normalized === 1) return 1.5;
  if (normalized === 3) return 4;
  if (normalized === 4) return 5.5;
  return 2.5;
}

function RelationshipTypeLinePreview(props: {
  lineShape: PostgresRelationshipLineShape;
  lineWeight: number;
  arrowhead: PostgresRelationshipArrowhead;
  color: string;
}) {
  const { lineShape, lineWeight, arrowhead, color } = props;
  const strokeWidth = getPostgresRelationshipStrokeWidth(lineWeight);
  const dasharray = getPostgresRelationshipStrokeDasharray(lineShape);
  const lineStartX = arrowhead === "double_sided" ? 14 : 8;
  const lineEndX = arrowhead === "none" ? 62 : 56;

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 70 24"
      width="70"
      height="24"
      style={{ display: "block", flexShrink: 0 }}
    >
      <line
        x1={lineStartX}
        y1="12"
        x2={lineEndX}
        y2="12"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={dasharray}
      />
      {arrowhead === "double_sided" ? (
        <path d="M8 12 L16 7.5 L16 16.5 Z" fill={color} />
      ) : null}
      {arrowhead !== "none" ? (
        <path d="M64 12 L56 7.5 L56 16.5 Z" fill={color} />
      ) : null}
    </svg>
  );
}

function PostgresObjectShapePicker(props: {
  value: PostgresObjectTypeShape | "";
  onChange: (value: PostgresObjectTypeShape | "") => void;
  previewColor: string;
  previewFill?: PostgresObjectFill;
  allowInherit?: boolean;
  inheritLabel?: string;
}) {
  const {
    value,
    onChange,
    previewColor,
    previewFill = "filled",
    allowInherit = false,
    inheritLabel = "Inherit",
  } = props;
  return (
    <div className="shape-picker-grid" role="radiogroup" aria-label="Shape selection">
      {allowInherit ? (
        <button
          type="button"
          className={`shape-picker-option${value === "" ? " shape-picker-option--selected" : ""}`}
          onClick={() => onChange("")}
          aria-pressed={value === ""}
        >
          <div className="shape-picker-preview shape-picker-preview--inherit" aria-hidden="true">
            <ObjectShapeSwatch
              shape="rounded"
              fill="outline"
              color="rgba(53, 80, 112, 0.55)"
              width={getObjectShapePreviewStyle("rounded").width}
              minHeight={getObjectShapePreviewStyle("rounded").minHeight}
              style={{ opacity: 0.72 }}
            />
          </div>
          <span className="shape-picker-label">{inheritLabel}</span>
        </button>
      ) : null}
      {POSTGRES_OBJECT_TYPE_SHAPE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`shape-picker-option${value === option.value ? " shape-picker-option--selected" : ""}`}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          title={option.label}
          style={{
            borderColor: value === option.value ? previewColor : hexToRgba(previewColor, 0.22),
            background: `linear-gradient(180deg, ${hexToRgba(previewColor, value === option.value ? 0.16 : 0.08)}, rgba(255, 255, 255, 0.96))`,
            boxShadow: value === option.value ? `0 0 0 1px ${hexToRgba(previewColor, 0.35)}` : undefined,
          }}
        >
          <div className="shape-picker-preview" aria-hidden="true">
            <ObjectShapeSwatch
              shape={option.value}
              fill={previewFill}
              color={previewColor}
              width={getObjectShapePreviewStyle(option.value).width}
              minHeight={getObjectShapePreviewStyle(option.value).minHeight}
            />
          </div>
          <span className="shape-picker-label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function PostgresObjectFillPicker(props: {
  value: PostgresObjectFill | "";
  onChange: (value: PostgresObjectFill | "") => void;
  previewColor: string;
  previewShape?: PostgresObjectTypeShape;
  allowInherit?: boolean;
  inheritLabel?: string;
}) {
  const {
    value,
    onChange,
    previewColor,
    previewShape = "rounded",
    allowInherit = false,
    inheritLabel = "Inherit",
  } = props;
  return (
    <div className="shape-picker-grid" role="radiogroup" aria-label="Fill selection">
      {allowInherit ? (
        <button
          type="button"
          className={`shape-picker-option${value === "" ? " shape-picker-option--selected" : ""}`}
          onClick={() => onChange("")}
          aria-pressed={value === ""}
        >
          <div className="shape-picker-preview" aria-hidden="true">
            <ObjectShapeSwatch
              shape={previewShape}
              fill="outline"
              color="rgba(53, 80, 112, 0.55)"
              width={getObjectShapePreviewStyle(previewShape).width}
              minHeight={getObjectShapePreviewStyle(previewShape).minHeight}
              style={{ opacity: 0.72 }}
            />
          </div>
          <span className="shape-picker-label">{inheritLabel}</span>
        </button>
      ) : null}
      {POSTGRES_OBJECT_FILL_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`shape-picker-option${value === option.value ? " shape-picker-option--selected" : ""}`}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          title={option.label}
          style={{
            borderColor: value === option.value ? previewColor : hexToRgba(previewColor, 0.22),
            background: `linear-gradient(180deg, ${hexToRgba(previewColor, value === option.value ? 0.16 : 0.08)}, rgba(255, 255, 255, 0.96))`,
            boxShadow: value === option.value ? `0 0 0 1px ${hexToRgba(previewColor, 0.35)}` : undefined,
          }}
        >
          <div className="shape-picker-preview" aria-hidden="true">
            <ObjectShapeSwatch
              shape={previewShape}
              fill={option.value}
              color={previewColor}
              width={getObjectShapePreviewStyle(previewShape).width}
              minHeight={getObjectShapePreviewStyle(previewShape).minHeight}
            />
          </div>
          <span className="shape-picker-label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function PostgresRelationshipLineShapePicker(props: {
  value: PostgresRelationshipLineShape | "";
  onChange: (value: PostgresRelationshipLineShape | "") => void;
  previewColor: string;
  allowInherit?: boolean;
  inheritLabel?: string;
}) {
  const {
    value,
    onChange,
    previewColor,
    allowInherit = false,
    inheritLabel = "Inherit",
  } = props;
  return (
    <div className="shape-picker-grid shape-picker-grid--lines" role="radiogroup" aria-label="Line shape selection">
      {allowInherit ? (
        <button
          type="button"
          className={`shape-picker-option${value === "" ? " shape-picker-option--selected" : ""}`}
          onClick={() => onChange("")}
          aria-pressed={value === ""}
        >
          <div className="shape-picker-preview shape-picker-preview--line" aria-hidden="true">
            <svg width="92" height="18" viewBox="0 0 92 18">
              <line
                x1="4"
                y1="9"
                x2="88"
                y2="9"
                stroke="rgba(53, 80, 112, 0.6)"
                strokeWidth="3"
                strokeDasharray="5 5"
              />
            </svg>
          </div>
          <span className="shape-picker-label">{inheritLabel}</span>
        </button>
      ) : null}
      {POSTGRES_RELATIONSHIP_LINE_SHAPE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`shape-picker-option${value === option.value ? " shape-picker-option--selected" : ""}`}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          title={option.label}
          style={{
            borderColor: value === option.value ? previewColor : hexToRgba(previewColor, 0.22),
            background: `linear-gradient(180deg, ${hexToRgba(previewColor, value === option.value ? 0.14 : 0.06)}, rgba(255, 255, 255, 0.96))`,
            boxShadow: value === option.value ? `0 0 0 1px ${hexToRgba(previewColor, 0.35)}` : undefined,
          }}
        >
          <div className="shape-picker-preview shape-picker-preview--line" aria-hidden="true">
            <svg width="92" height="18" viewBox="0 0 92 18">
              <line
                x1="4"
                y1="9"
                x2="88"
                y2="9"
                stroke={previewColor}
                strokeWidth="3"
                strokeDasharray={getPostgresRelationshipStrokeDasharray(option.value)}
              />
            </svg>
          </div>
          <span className="shape-picker-label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function PostgresRelationshipLineWeightPicker(props: {
  value: number | null;
  onChange: (value: number | null) => void;
  previewColor: string;
  allowInherit?: boolean;
  inheritLabel?: string;
}) {
  const { value, onChange, previewColor, allowInherit = false, inheritLabel = "Inherit" } = props;
  return (
    <div className="shape-picker-grid shape-picker-grid--lines" role="radiogroup" aria-label="Line weight selection">
      {allowInherit ? (
        <button
          type="button"
          className={`shape-picker-option${value === null ? " shape-picker-option--selected" : ""}`}
          onClick={() => onChange(null)}
          aria-pressed={value === null}
        >
          <div className="shape-picker-preview shape-picker-preview--line" aria-hidden="true">
            <svg width="108" height="24" viewBox="0 0 108 24">
              <line
                x1="10"
                y1="12"
                x2="98"
                y2="12"
                stroke="rgba(53, 80, 112, 0.6)"
                strokeWidth="2"
                strokeDasharray="5 5"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <span className="shape-picker-label">{inheritLabel}</span>
        </button>
      ) : null}
      {POSTGRES_RELATIONSHIP_LINE_WEIGHT_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`shape-picker-option${value === option.value ? " shape-picker-option--selected" : ""}`}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          title={option.label}
          style={{
            borderColor: value === option.value ? previewColor : hexToRgba(previewColor, 0.22),
            background: `linear-gradient(180deg, ${hexToRgba(previewColor, value === option.value ? 0.14 : 0.06)}, rgba(255, 255, 255, 0.96))`,
            boxShadow: value === option.value ? `0 0 0 1px ${hexToRgba(previewColor, 0.35)}` : undefined,
          }}
        >
          <div className="shape-picker-preview shape-picker-preview--line" aria-hidden="true">
            <svg width="108" height="24" viewBox="0 0 108 24">
              <line
                x1="10"
                y1="12"
                x2="98"
                y2="12"
                stroke={previewColor}
                strokeWidth={getPostgresRelationshipStrokeWidth(option.value)}
                strokeLinecap="round"
              />
            </svg>
          </div>
          <span className="shape-picker-label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function PostgresRelationshipArrowheadPicker(props: {
  value: PostgresRelationshipArrowhead | "";
  onChange: (value: PostgresRelationshipArrowhead | "") => void;
  previewColor: string;
  allowInherit?: boolean;
  inheritLabel?: string;
}) {
  const { value, onChange, previewColor, allowInherit = false, inheritLabel = "Inherit" } = props;
  return (
    <div className="shape-picker-grid shape-picker-grid--lines" role="radiogroup" aria-label="Arrowhead selection">
      {allowInherit ? (
        <button
          type="button"
          className={`shape-picker-option${value === "" ? " shape-picker-option--selected" : ""}`}
          onClick={() => onChange("")}
          aria-pressed={value === ""}
        >
          <div className="shape-picker-preview shape-picker-preview--line" aria-hidden="true">
            <svg width="92" height="18" viewBox="0 0 92 18">
              <line x1="4" y1="9" x2="88" y2="9" stroke="rgba(53, 80, 112, 0.6)" strokeWidth="2" strokeDasharray="5 5" />
            </svg>
          </div>
          <span className="shape-picker-label">{inheritLabel}</span>
        </button>
      ) : null}
      {POSTGRES_RELATIONSHIP_ARROWHEAD_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`shape-picker-option${value === option.value ? " shape-picker-option--selected" : ""}`}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          title={option.label}
          style={{
            borderColor: value === option.value ? previewColor : hexToRgba(previewColor, 0.22),
            background: `linear-gradient(180deg, ${hexToRgba(previewColor, value === option.value ? 0.14 : 0.06)}, rgba(255, 255, 255, 0.96))`,
            boxShadow: value === option.value ? `0 0 0 1px ${hexToRgba(previewColor, 0.35)}` : undefined,
          }}
        >
          <div className="shape-picker-preview shape-picker-preview--line" aria-hidden="true">
            <svg width="92" height="18" viewBox="0 0 92 18">
              <defs>
                <marker id={`arrow-end-${option.value}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" fill={previewColor} />
                </marker>
                <marker id={`arrow-start-${option.value}`} markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto">
                  <path d="M8,0 L0,4 L8,8 z" fill={previewColor} />
                </marker>
              </defs>
              <line
                x1="4"
                y1="9"
                x2="88"
                y2="9"
                stroke={previewColor}
                strokeWidth="2.5"
                markerEnd={option.value === "none" ? undefined : `url(#arrow-end-${option.value})`}
                markerStart={option.value === "double_sided" ? `url(#arrow-start-${option.value})` : undefined}
              />
            </svg>
          </div>
          <span className="shape-picker-label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function getPostgresRelationshipStrokeDasharray(lineShape: PostgresRelationshipLineShape): string | undefined {
  if (lineShape === "dashed") return "8 6";
  if (lineShape === "dotted") return "2 6";
  return undefined;
}

function hexToRgba(hex: string, alpha: number): string {
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

function getPostgresObjectSurfaceStyle(
  color: string,
  fill: PostgresObjectFill,
  selected = false,
): {
  background: string;
  boxShadow: string;
  edgeColor: string;
  textColor: string;
} {
  const edgeColor = fill === "outline"
    ? color
    : selected
      ? color
      : hexToRgba(color, 0.34);
  if (fill === "outline") {
    return {
      background: "rgba(255, 255, 255, 0.98)",
      boxShadow: selected ? `0 22px 42px ${hexToRgba(color, 0.16)}` : `0 18px 36px ${hexToRgba(color, 0.08)}`,
      edgeColor,
      textColor: "#1f2933",
    };
  }
  return {
    background: `linear-gradient(180deg, ${hexToRgba(color, 0.94)}, ${hexToRgba(color, 0.78)})`,
    boxShadow: selected ? `0 22px 42px ${hexToRgba(color, 0.22)}` : `0 18px 36px ${hexToRgba(color, 0.14)}`,
    edgeColor,
    textColor: getCanvasNodeTextColor(color),
  };
}

type CanvasNodeShapeConfig = {
  width: number;
  height: number;
  borderRadius: number | string;
  clipPath?: string;
  previewWidth: number;
  previewHeight: number;
  contentPadding: string;
  contentAlign: {
    justifyContent: React.CSSProperties["justifyContent"];
    alignItems: React.CSSProperties["alignItems"];
    textAlign: React.CSSProperties["textAlign"];
  };
  handleTarget: React.CSSProperties;
  handleSource: React.CSSProperties;
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

function getCanvasNodeShapeConfig(shape: PostgresObjectTypeShape): CanvasNodeShapeConfig {
  return CANVAS_NODE_SHAPE_CONFIGS[shape] ?? CANVAS_NODE_SHAPE_CONFIGS.rounded;
}

function getObjectShapePreviewStyle(shape: PostgresObjectTypeShape): {
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

function getCanvasNodeDefaultDimensions(shape: PostgresObjectTypeShape): {
  width: number;
  height: number;
} {
  const config = getCanvasNodeShapeConfig(shape);
  return {
    width: config.width,
    height: config.height,
  };
}

function getCanvasNodeRenderedDimensions(
  shape: PostgresObjectTypeShape,
  _nodeState?: Pick<PostgresCanvasNodeState, "width" | "height"> | null,
): {
  width: number;
  height: number;
} {
  return getCanvasNodeDefaultDimensions(shape);
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getSvgShapePoints(shape: PostgresObjectTypeShape, width: number, height: number): string | null {
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
  if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) {
    return center;
  }

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

function getCanvasNodeBoundaryPoint(
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
  if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) {
    return center;
  }

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
    polygonPoints
      ?? `0,0 ${bounds.width},0 ${bounds.width},${bounds.height} 0,${bounds.height}`,
  ).map((point) => ({
    x: bounds.x + point.x,
    y: bounds.y + point.y,
  }));
  return getRayPolygonIntersection(center, toward, points);
}

function renderSvgObjectShape(
  shape: PostgresObjectTypeShape,
  width: number,
  height: number,
  color: string,
  fill: PostgresObjectFill,
  sourceVisualKey: PostgresSourceObjectVisualKey | null = null,
): string {
  if (sourceVisualKey) {
    const strokeColor = color;
    const iconColor = color;
    const insetX = width * 0.12;
    const insetY = height * 0.08;
    const foldStartX = width * 0.64;
    const foldTipX = width * 0.88;
    const foldTipY = height * 0.32;
    const basePath = `M${insetX} ${insetY} H${foldStartX} L${foldTipX} ${foldTipY} V${height * 0.88} H${insetX} Z`;
    const foldLine = `<path d="M${foldStartX} ${insetY} V${foldTipY} H${foldTipX}" fill="none" stroke="${strokeColor}" stroke-width="${Math.max(2.5, width * 0.018)}" stroke-linejoin="round" stroke-linecap="round" />`;
    let iconMarkup = "";
    switch (sourceVisualKey) {
      case "source_text":
        iconMarkup = `<text x="${width / 2}" y="${height * 0.63}" text-anchor="middle" font-size="${Math.max(20, width * 0.2)}" font-weight="800" font-family="Arial, sans-serif" letter-spacing="1" fill="${iconColor}">TXT</text>`;
        break;
      case "source_processed_transcript":
        iconMarkup = [
          `<path d="M${width * 0.28} ${height * 0.44} H${width * 0.72} M${width * 0.28} ${height * 0.54} H${width * 0.72} M${width * 0.28} ${height * 0.64} H${width * 0.56}" fill="none" stroke="${iconColor}" stroke-width="${Math.max(4, width * 0.03)}" stroke-linecap="round" />`,
          `<path d="M${width * 0.62} ${height * 0.66} L${width * 0.7} ${height * 0.74} L${width * 0.84} ${height * 0.58}" fill="none" stroke="${iconColor}" stroke-width="${Math.max(4, width * 0.03)}" stroke-linecap="round" stroke-linejoin="round" />`,
        ].join("");
        break;
      case "source_pdf": {
        const backInsetX = width * 0.18;
        const backInsetY = height * 0.22;
        const frontInsetX = width * 0.26;
        const frontInsetY = height * 0.12;
        const frontFoldX = width * 0.68;
        const frontTipX = width * 0.84;
        const frontTipY = height * 0.28;
        iconMarkup = [
          `<path d="M${backInsetX} ${backInsetY} H${width * 0.74} V${height * 0.76} H${backInsetX} Z" fill="none" stroke="${iconColor}" stroke-width="${Math.max(4, width * 0.03)}" stroke-linejoin="round" />`,
          `<path d="M${frontInsetX} ${frontInsetY} H${frontFoldX} L${frontTipX} ${frontTipY} V${height * 0.68} H${frontInsetX} Z" fill="#ffffff" stroke="${iconColor}" stroke-width="${Math.max(4, width * 0.03)}" stroke-linejoin="round" />`,
          `<path d="M${frontFoldX} ${frontInsetY} V${frontTipY} H${frontTipX}" fill="none" stroke="${iconColor}" stroke-width="${Math.max(3, width * 0.024)}" stroke-linejoin="round" stroke-linecap="round" />`,
          `<path d="M${width * 0.38} ${height * 0.42} H${width * 0.66} M${width * 0.38} ${height * 0.52} H${width * 0.62}" fill="none" stroke="${iconColor}" stroke-width="${Math.max(3, width * 0.024)}" stroke-linecap="round" />`,
        ].join("");
        break;
      }
      case "source_audio":
        iconMarkup = `<path d="M${width * 0.24} ${height * 0.57} C${width * 0.29} ${height * 0.49}, ${width * 0.33} ${height * 0.49}, ${width * 0.38} ${height * 0.57} S${width * 0.47} ${height * 0.65}, ${width * 0.52} ${height * 0.57} S${width * 0.61} ${height * 0.49}, ${width * 0.66} ${height * 0.57} S${width * 0.75} ${height * 0.65}, ${width * 0.8} ${height * 0.57}" fill="none" stroke="${iconColor}" stroke-width="${Math.max(5, width * 0.045)}" stroke-linecap="round" stroke-linejoin="round" />`;
        break;
      case "source_video":
        iconMarkup = `<path d="M${width * 0.42} ${height * 0.4} L${width * 0.42} ${height * 0.72} L${width * 0.69} ${height * 0.56} Z" fill="${iconColor}" />`;
        break;
      case "source_image":
        iconMarkup = `<rect x="${width * 0.28}" y="${height * 0.38}" width="${width * 0.44}" height="${height * 0.3}" rx="${Math.max(3, width * 0.02)}" ry="${Math.max(3, width * 0.02)}" fill="none" stroke="${iconColor}" stroke-width="${Math.max(4, width * 0.03)}" /><circle cx="${width * 0.39}" cy="${height * 0.46}" r="${Math.max(4, width * 0.03)}" fill="${iconColor}" /><path d="M${width * 0.32} ${height * 0.66} L${width * 0.46} ${height * 0.52} L${width * 0.55} ${height * 0.61} L${width * 0.63} ${height * 0.52} L${width * 0.72} ${height * 0.66}" fill="none" stroke="${iconColor}" stroke-width="${Math.max(4, width * 0.03)}" stroke-linecap="round" stroke-linejoin="round" />`;
        break;
    }
    return `<path d="${basePath}" fill="#ffffff" stroke="${strokeColor}" stroke-width="${Math.max(3, width * 0.02)}" stroke-linejoin="round" />${foldLine}${iconMarkup}`;
  }
  const fillColor = fill === "filled" ? color : "#ffffff";
  const points = getSvgShapePoints(shape, width, height);
  if (points) {
    return `<polygon points="${points}" fill="${fillColor}" stroke="${color}" stroke-width="2" />`;
  }
  if (shape === "rectangle") {
    return `<rect x="0" y="0" width="${width}" height="${height}" fill="${fillColor}" stroke="${color}" stroke-width="2" />`;
  }
  if (shape === "rounded") {
    const radius = Math.max(0, (Math.min(width, height) / 2) - 4);
    return `<circle cx="${width / 2}" cy="${height / 2}" r="${radius}" fill="${fillColor}" stroke="${color}" stroke-width="2" />`;
  }
  return `<rect x="0" y="0" width="${width}" height="${height}" rx="${Math.min(22, height / 3)}" ry="${Math.min(22, height / 3)}" fill="${fillColor}" stroke="${color}" stroke-width="2" />`;
}

function getCanvasSketchShapeType(shape: PostgresCanvasShape): PostgresCanvasDisplayShape {
  if (shape.kind === "shape") return shape.shape;
  return "rectangle";
}

function getCanvasSketchShapeFill(
  shape: Extract<PostgresCanvasShape, { kind: "rectangle" | "shape" }>,
): PostgresObjectFill {
  return shape.fill === "outline" ? "outline" : "filled";
}

function getCanvasSketchLineStyle(
  shape: Extract<PostgresCanvasShape, { kind: "pen" | "rectangle" | "shape" }>,
): PostgresRelationshipLineShape {
  return normalizePostgresRelationshipLineShape(shape.lineStyle ?? "");
}

function formatCanvasSketchShapeLabel(shape: PostgresCanvasDisplayShape): string {
  return formatPostgresObjectShapeLabel(shape);
}

function stripCanvasRichText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|h1|h2|h3|h4|h5|h6)>/gi, "\n")
    .replace(/<li>/gi, "* ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
}

function renderCanvasTextForeignObjectSvg(
  shape: Extract<PostgresCanvasShape, { kind: "text" }>,
  minX: number,
  minY: number,
): string {
  const x = shape.x - minX;
  const y = shape.y - minY;
  const html = normalizeCanvasSvgTextHtml(shape.html);
  return `
    <foreignObject x="${x}" y="${y}" width="${shape.width}" height="${shape.height}">
      <div xmlns="http://www.w3.org/1999/xhtml" style="width:${shape.width}px;min-height:${shape.height}px;box-sizing:border-box;padding:6px 8px;color:${shape.color};font: ${shape.fontSize}px/1.35 Inter, sans-serif;text-align:${shape.textAlign};overflow-wrap:anywhere;word-break:break-word;white-space:normal;">
        ${html}
      </div>
    </foreignObject>
  `;
}

function wrapCanvasTextLines(text: string, width: number, fontSize: number): string[] {
  const normalized = text.replace(/\r/g, "");
  const maxCharsPerLine = Math.max(8, Math.floor((width - 16) / Math.max(fontSize * 0.58, 1)));
  const paragraphs = normalized.split("\n");
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }

    let currentLine = "";
    for (const word of words) {
      const nextLine = currentLine ? `${currentLine} ${word}` : word;
      if (nextLine.length <= maxCharsPerLine) {
        currentLine = nextLine;
        continue;
      }
      if (currentLine) {
        lines.push(currentLine);
      }
      if (word.length <= maxCharsPerLine) {
        currentLine = word;
        continue;
      }
      for (let index = 0; index < word.length; index += maxCharsPerLine) {
        const chunk = word.slice(index, index + maxCharsPerLine);
        if (chunk.length === maxCharsPerLine) {
          lines.push(chunk);
        } else {
          currentLine = chunk;
        }
      }
      if (word.length % maxCharsPerLine === 0) {
        currentLine = "";
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines.length ? lines : ["Text"];
}

/* function CanvasRichTextEditor(props: {
  shape: Extract<PostgresCanvasShape, { kind: "text" }>;
  canvasScale: number;
  isReadOnly: boolean;
  canvasTool: PostgresCanvasTool;
  onBeginMove: (event: React.PointerEvent<Element>, shape: PostgresCanvasShape) => void;
  onBeginEditing: (shapeId: string) => void;
  onDelete: (shapeId: string) => void;
  onSelect: () => void;
  onUpdate: (
    updater: (
      shape: Extract<PostgresCanvasShape, { kind: "text" }>,
    ) => Extract<PostgresCanvasShape, { kind: "text" }>,
  ) => void;
}) {
  const {
    shape,
    canvasScale,
    isReadOnly,
    canvasTool,
    onBeginMove,
    onBeginEditing,
    onDelete,
    onSelect,
    onUpdate,
  } = props;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      TiptapFontSize,
      Color.configure({ types: ["textStyle"] }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: normalizeCanvasTextHtml(shape.html),
    editable: !isReadOnly,
    editorProps: {
      attributes: {
        class: "canvas-rich-text-editor",
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      const html = normalizeCanvasTextHtml(activeEditor.getHTML());
      onUpdate((current) => ({ ...current, html }));
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!isReadOnly);
  }, [editor, isReadOnly]);

  useEffect(() => {
    if (!editor) return;
    editor.commands.focus("end");
  }, [editor, shape.id]);

  const editorSurfaceStyle: CSSProperties = {
    minHeight: shape.height,
    padding: "6px 8px",
    outline: "none",
    borderRadius: 8,
    border: "1px solid rgba(53, 80, 112, 0.28)",
    background: "rgba(255, 255, 255, 0.86)",
    color: shape.color,
    fontSize: shape.fontSize,
    lineHeight: 1.35,
    textAlign: shape.textAlign,
    whiteSpace: "normal",
    cursor: "text",
    boxSizing: "border-box",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  };

  const menuButtonStyle = (active?: boolean): CSSProperties => ({
    minWidth: 32,
    height: 32,
    padding: "0 8px",
    justifyContent: "center",
    background: active ? "rgba(53, 80, 112, 0.10)" : undefined,
  });
  const activeFontSize = String(editor?.getAttributes("textStyle").fontSize ?? `${shape.fontSize}px`);

  return (
    <>
      {editor ? (
        <BubbleMenu
          editor={editor}
          shouldShow={(props: { editor: { isFocused: boolean } }) => props.editor.isFocused}
          options={{
            placement: "top-start",
            offset: 10,
          }}
        >
          <div
            data-text-editor-toolbar="true"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              padding: 6,
              borderRadius: 12,
              border: "1px solid rgba(53, 80, 112, 0.14)",
              background: "rgba(255, 255, 255, 0.98)",
              boxShadow: "0 12px 24px rgba(15, 23, 42, 0.12)",
              transform: `scale(${1 / canvasScale})`,
              transformOrigin: "left bottom",
              pointerEvents: "auto",
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "auto auto",
                gap: 10,
                alignItems: "stretch",
              }}
            >
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {[
                    { label: "B", isActive: editor.isActive("bold"), onClick: () => editor.chain().focus().toggleBold().run(), style: { fontWeight: 800 } },
                    { label: "I", isActive: editor.isActive("italic"), onClick: () => editor.chain().focus().toggleItalic().run(), style: { fontStyle: "italic" } },
                    { label: "U", isActive: editor.isActive("underline"), onClick: () => editor.chain().focus().toggleUnderline().run(), style: { textDecoration: "underline" } },
                    { label: "S", isActive: editor.isActive("strike"), onClick: () => editor.chain().focus().toggleStrike().run(), style: { textDecoration: "line-through" } },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      className="btn btn--ghost"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        item.onClick();
                      }}
                      style={{ ...menuButtonStyle(item.isActive), ...(item.style ?? {}) }}
                    >
                      {item.label}
                    </button>
                  ))}
                  <select
                    value={activeFontSize}
                    onMouseDown={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      const nextFontSize = event.target.value;
                      const parsedFontSize = Number(nextFontSize.replace("px", ""));
                      if (Number.isFinite(parsedFontSize)) {
                        onUpdate((current) => ({ ...current, fontSize: parsedFontSize }));
                      }
                      editor.chain().focus().setFontSize(nextFontSize).run();
                    }}
                    style={{
                      height: 32,
                      borderRadius: 10,
                      border: "1px solid rgba(53, 80, 112, 0.16)",
                      background: "#ffffff",
                      color: "#1f2933",
                      padding: "0 8px",
                    }}
                  >
                    {[14, 16, 18, 20, 24, 28, 32].map((fontSize) => (
                      <option key={fontSize} value={`${fontSize}px`}>{fontSize}px</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {[
                    { label: "•", isActive: editor.isActive("bulletList"), onClick: () => editor.chain().focus().toggleBulletList().run() },
                    { label: "1.", isActive: editor.isActive("orderedList"), onClick: () => editor.chain().focus().toggleOrderedList().run() },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      className="btn btn--ghost"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        item.onClick();
                      }}
                      style={menuButtonStyle(item.isActive)}
                    >
                      {item.label}
                    </button>
                  ))}
                  <div style={{ width: 1, height: 24, background: "rgba(53, 80, 112, 0.12)" }} />
                  {([
                    { value: "left", title: "Align left", x1: 4, x2: 12 },
                    { value: "center", title: "Align center", x1: 6, x2: 14 },
                    { value: "right", title: "Align right", x1: 8, x2: 16 },
                  ] as const).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className="btn btn--ghost"
                      aria-label={option.title}
                      title={option.title}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        onUpdate((current) => ({ ...current, textAlign: option.value }));
                        editor.chain().focus().setTextAlign(option.value).run();
                      }}
                      style={menuButtonStyle(editor.isActive({ textAlign: option.value }))}
                    >
                      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ display: "block" }}>
                        <line x1="4" y1="5" x2="16" y2="5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                        <line x1={option.x1} y1="10" x2={option.x2} y2="10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                        <line x1="4" y1="15" x2="16" y2="15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateRows: "1fr 1fr",
                  gap: 8,
                  alignItems: "stretch",
                  minWidth: 104,
                }}
              >
                <input
                  className="form-input form-input--color"
                  type="color"
                  value={shape.color}
                  aria-label="Text color"
                  onMouseDown={(event) => event.stopPropagation()}
                  onChange={(event) => {
                    const nextColor = event.target.value;
                    onUpdate((current) => ({ ...current, color: nextColor }));
                    editor.chain().focus().setColor(nextColor).run();
                  }}
                  style={{ width: "100%", minWidth: 0, height: 32, padding: 3 }}
                />
                <input
                  className="form-input"
                  value={shape.color}
                  aria-label="Text color hex value"
                  onMouseDown={(event) => event.stopPropagation()}
                  onChange={(event) => {
                    const nextColor = normalizePostgresObjectTypeColor(event.target.value);
                    onUpdate((current) => ({ ...current, color: nextColor }));
                    editor.chain().focus().setColor(nextColor).run();
                  }}
                  style={{
                    width: 104,
                    height: 32,
                    borderRadius: 10,
                    fontFamily: "monospace",
                  }}
                />
              </div>
            </div>
          </div>
        </BubbleMenu>
      ) : null}
      <div
        data-canvas-text-editor-id={shape.id}
        onPointerDown={(event) => {
          event.stopPropagation();
          if (canvasTool === "eraser") {
            onDelete(shape.id);
            return;
          }
          if (canvasTool === "select") {
            onBeginMove(event, shape);
            return;
          }
          if (canvasTool === "text") {
            onBeginEditing(shape.id);
            return;
          }
          onSelect();
        }}
        style={editorSurfaceStyle}
      >
        <EditorContent editor={editor} />
      </div>
    </>
  );
} */

function renderCanvasSketchShapeElement(
  shape: Extract<PostgresCanvasShape, { kind: "rectangle" | "shape" }>,
  selected: boolean,
) {
  const stroke = selected ? "#d62828" : shape.color;
  const strokeWidth = selected ? shape.strokeWidth + 1 : shape.strokeWidth;
  const strokeDasharray = getPostgresRelationshipStrokeDasharray(getCanvasSketchLineStyle(shape));
  const fillMode = getCanvasSketchShapeFill(shape);
  const fill = selected
    ? "rgba(214, 40, 40, 0.08)"
    : fillMode === "outline"
      ? "#ffffff"
      : hexToRgba(shape.color, 0.08);
  const shapeType = getCanvasSketchShapeType(shape);

  if (shapeType === "rectangle") {
    return (
      <rect
        x={shape.x}
        y={shape.y}
        width={shape.width}
        height={shape.height}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        pointerEvents="all"
        style={{ cursor: "pointer" }}
      />
    );
  }

  if (shapeType === "rounded") {
    const radius = Math.max(0, (Math.min(shape.width, shape.height) / 2) - strokeWidth / 2);
    return (
      <circle
        cx={shape.x + shape.width / 2}
        cy={shape.y + shape.height / 2}
        r={radius}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        pointerEvents="all"
        style={{ cursor: "pointer" }}
      />
    );
  }

  const points = getSvgShapePoints(shapeType, shape.width, shape.height);
  const shiftedPoints = (points ?? "")
    .split(" ")
    .map((pair) => {
      const [px, py] = pair.split(",").map(Number);
      return `${shape.x + px},${shape.y + py}`;
    })
    .join(" ");

  return (
    <polygon
      points={shiftedPoints}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeDasharray={strokeDasharray}
      strokeLinejoin="round"
      pointerEvents="all"
      style={{ cursor: "pointer" }}
    />
  );
}

function getCanvasShapeBounds(shape: PostgresCanvasShape): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (shape.kind === "pen") {
    const xs = shape.points.map((point) => point.x);
    const ys = shape.points.map((point) => point.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    return {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    };
  }
  return {
    x: shape.x,
    y: shape.y,
    width: shape.width,
    height: shape.height,
  };
}

function translateCanvasShape(
  shape: PostgresCanvasShape,
  deltaX: number,
  deltaY: number,
): PostgresCanvasShape {
  if (shape.kind === "pen") {
    return {
      ...shape,
      points: shape.points.map((point) => ({ x: point.x + deltaX, y: point.y + deltaY })),
    };
  }
  return {
    ...shape,
    x: shape.x + deltaX,
    y: shape.y + deltaY,
  };
}

function distancePointToSegment(
  point: PostgresCanvasPoint,
  start: PostgresCanvasPoint,
  end: PostgresCanvasPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / ((dx * dx) + (dy * dy))));
  const projectionX = start.x + (t * dx);
  const projectionY = start.y + (t * dy);
  return Math.hypot(point.x - projectionX, point.y - projectionY);
}

function isWorldPointInsideCanvasShape(
  shape: PostgresCanvasShape,
  point: PostgresCanvasPoint,
): boolean {
  if (shape.kind === "pen") {
    for (let index = 1; index < shape.points.length; index += 1) {
      if (distancePointToSegment(point, shape.points[index - 1], shape.points[index]) <= Math.max(10, shape.strokeWidth + 6)) {
        return true;
      }
    }
    return false;
  }

  const bounds = getCanvasShapeBounds(shape);
  return (
    point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height
  );
}

function resizeCanvasBoxShape(
  shape: Extract<PostgresCanvasShape, { kind: "rectangle" | "shape" | "text" }>,
  handle: "nw" | "ne" | "sw" | "se",
  currentX: number,
  currentY: number,
): Extract<PostgresCanvasShape, { kind: "rectangle" | "shape" | "text" }> {
  const minSize = 24;
  const left = shape.x;
  const top = shape.y;
  const right = shape.x + shape.width;
  const bottom = shape.y + shape.height;
  const anchorX = handle === "nw" || handle === "sw" ? right : left;
  const anchorY = handle === "nw" || handle === "ne" ? bottom : top;
  const rawLeft = Math.min(anchorX, currentX);
  const rawRight = Math.max(anchorX, currentX);
  const rawTop = Math.min(anchorY, currentY);
  const rawBottom = Math.max(anchorY, currentY);
  const width = Math.max(minSize, rawRight - rawLeft);
  const height = Math.max(minSize, rawBottom - rawTop);

  return {
    ...shape,
    x: handle === "nw" || handle === "sw" ? anchorX - width : anchorX,
    y: handle === "nw" || handle === "ne" ? anchorY - height : anchorY,
    width,
    height,
  };
}

function renderCanvasSketchShapeSvg(
  shape: PostgresCanvasShape,
  minX: number,
  minY: number,
  mode: "screen" | "pdf" = "screen",
): string {
  if (shape.kind === "pen") {
    const strokeDasharray = getPostgresRelationshipStrokeDasharray(getCanvasSketchLineStyle(shape));
    return `<polyline points="${shape.points.map((point: PostgresCanvasPoint) => `${point.x - minX},${point.y - minY}`).join(" ")}" fill="none" stroke="${shape.color}" stroke-width="${shape.strokeWidth}"${strokeDasharray ? ` stroke-dasharray="${strokeDasharray}"` : ""} stroke-linecap="round" stroke-linejoin="round" />`;
  }
  if (shape.kind === "text") {
    if (mode === "screen") {
      return renderCanvasTextForeignObjectSvg(shape, minX, minY);
    }
    const plainText = stripCanvasRichText(shape.html) || "Text";
    const lines = wrapCanvasTextLines(plainText, shape.width, shape.fontSize);
    const anchor = shape.textAlign === "center" ? "middle" : shape.textAlign === "right" ? "end" : "start";
    const textX = shape.textAlign === "center"
      ? shape.x - minX + (shape.width / 2)
      : shape.textAlign === "right"
        ? shape.x - minX + shape.width
        : shape.x - minX;
    const baseY = shape.y - minY + shape.fontSize;
    const tspans = lines.map((line, index) => (
      `<tspan x="${textX}" y="${baseY + (index * (shape.fontSize * 1.35))}">${escapeSvgText(line)}</tspan>`
    )).join("");
    return `<text font-family="Inter, sans-serif" font-size="${shape.fontSize}" fill="${shape.color}" text-anchor="${anchor}">${tspans}</text>`;
  }
  const shapeType = getCanvasSketchShapeType(shape);
  const x = shape.x - minX;
  const y = shape.y - minY;
  const strokeDasharray = getPostgresRelationshipStrokeDasharray(getCanvasSketchLineStyle(shape));
  const fillMode = getCanvasSketchShapeFill(shape);
  const fillColor = fillMode === "outline" ? "#ffffff" : hexToRgba(shape.color, 0.08);
  if (shapeType === "rectangle") {
    return `<rect x="${x}" y="${y}" width="${shape.width}" height="${shape.height}" fill="${fillColor}" stroke="${shape.color}" stroke-width="${shape.strokeWidth}"${strokeDasharray ? ` stroke-dasharray="${strokeDasharray}"` : ""} />`;
  }
  if (shapeType === "rounded") {
    const radius = Math.max(0, (Math.min(shape.width, shape.height) / 2) - shape.strokeWidth / 2);
    return `<circle cx="${x + shape.width / 2}" cy="${y + shape.height / 2}" r="${radius}" fill="${fillColor}" stroke="${shape.color}" stroke-width="${shape.strokeWidth}"${strokeDasharray ? ` stroke-dasharray="${strokeDasharray}"` : ""} />`;
  }
  const points = getSvgShapePoints(shapeType, shape.width, shape.height);
  if (points) {
    const shiftedPoints = points
      .split(" ")
      .map((pair) => {
        const [px, py] = pair.split(",").map(Number);
        return `${x + px},${y + py}`;
      })
      .join(" ");
    return `<polygon points="${shiftedPoints}" fill="${fillColor}" stroke="${shape.color}" stroke-width="${shape.strokeWidth}"${strokeDasharray ? ` stroke-dasharray="${strokeDasharray}"` : ""} stroke-linejoin="round" />`;
  }
  return `<rect x="${x}" y="${y}" width="${shape.width}" height="${shape.height}" fill="${fillColor}" stroke="${shape.color}" stroke-width="${shape.strokeWidth}"${strokeDasharray ? ` stroke-dasharray="${strokeDasharray}"` : ""} />`;
}

function sanitizeFileStem(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "saved-canvas";
  return trimmed.replace(/[<>:\"/\\|?*\u0000-\u001F]+/g, "-").replace(/\s+/g, " ").trim();
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function getPostgresImageMimeType(storagePath: string): string {
  const extension = storagePath.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "svg") return "image/svg+xml";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  return "image/jpeg";
}

function resolvePostgresStoragePath(projectStoragePath: string, relativeStoragePath: string): string {
  const trimmedRelativePath = relativeStoragePath.trim();
  if (!trimmedRelativePath) return "";
  if (/^[a-zA-Z]:[\\/]/.test(trimmedRelativePath) || trimmedRelativePath.startsWith("\\\\")) {
    return trimmedRelativePath;
  }
  const trimmedProjectPath = projectStoragePath.trim().replace(/[\\/]+$/, "");
  const normalizedRelativePath = trimmedRelativePath.replace(/^[\\/]+/, "");
  return trimmedProjectPath ? `${trimmedProjectPath}\\${normalizedRelativePath}` : normalizedRelativePath;
}

function getFileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || "image";
}

function formatPostgresFileSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 1024 * 1024 ? 1 : 2)} MB`;
}

function getPostgresCropAspectRatio(
  aspect: PostgresImageCropAspect,
  imageWidth: number,
  imageHeight: number,
): number {
  if (aspect === "1:1") return 1;
  if (aspect === "4:3") return 4 / 3;
  if (aspect === "16:9") return 16 / 9;
  return imageWidth / imageHeight;
}

function getPostgresCropRect(
  imageWidth: number,
  imageHeight: number,
  aspect: PostgresImageCropAspect,
  sizePercent: number,
  xPercent: number,
  yPercent: number,
) {
  const ratio = getPostgresCropAspectRatio(aspect, imageWidth, imageHeight);
  const imageRatio = imageWidth / imageHeight;
  const maxCropWidth = imageRatio > ratio ? imageHeight * ratio : imageWidth;
  const maxCropHeight = imageRatio > ratio ? imageHeight : imageWidth / ratio;
  const scale = Math.min(1, Math.max(0.2, sizePercent / 100));
  const width = Math.max(1, maxCropWidth * scale);
  const height = Math.max(1, maxCropHeight * scale);
  const x = Math.max(0, (imageWidth - width) * Math.min(100, Math.max(0, xPercent)) / 100);
  const y = Math.max(0, (imageHeight - height) * Math.min(100, Math.max(0, yPercent)) / 100);
  return { x, y, width, height };
}

function loadPostgresImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load the selected image for cropping."));
    image.src = src;
  });
}

function canvasToPostgresBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Could not prepare the cropped image."));
      }
    }, mimeType, quality);
  });
}

function getPostgresCroppedImageFileName(originalFileName: string, mimeType: string): string {
  const stem = sanitizeFileStem(originalFileName.replace(/\.[^.]+$/, "")) || "image";
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
  return `${stem}-cropped.${extension}`;
}

async function cropPostgresImageUpload(
  upload: PostgresImageUploadDraft,
  aspect: PostgresImageCropAspect,
  sizePercent: number,
  xPercent: number,
  yPercent: number,
): Promise<PostgresImageUploadDraft> {
  const image = await loadPostgresImageElement(upload.previewUrl);
  const crop = getPostgresCropRect(image.naturalWidth, image.naturalHeight, aspect, sizePercent, xPercent, yPercent);
  const maxOutputDimension = 1600;
  const outputScale = Math.min(1, maxOutputDimension / Math.max(crop.width, crop.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop.width * outputScale));
  canvas.height = Math.max(1, Math.round(crop.height * outputScale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare the cropped image.");
  context.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const sourceMimeType = getPostgresImageMimeType(upload.originalFileName);
  const outputMimeType = sourceMimeType === "image/jpeg" || sourceMimeType === "image/webp" ? sourceMimeType : "image/png";
  const blob = await canvasToPostgresBlob(canvas, outputMimeType, 0.9);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    originalFileName: getPostgresCroppedImageFileName(upload.originalFileName, outputMimeType),
    fileBytesBase64: bytesToBase64(bytes),
    previewUrl: URL.createObjectURL(blob),
    fileSizeBytes: bytes.length,
  };
}

function usePostgresStoredImageUrl(projectStoragePath: string, imageStoragePath: string): string {
  const [imageUrl, setImageUrl] = useState("");

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    const resolvedPath = resolvePostgresStoragePath(projectStoragePath, imageStoragePath);
    if (!resolvedPath) {
      setImageUrl("");
      return;
    }
    void readTauriFile(resolvedPath)
      .then((bytes) => {
        if (!active) return;
        const blob = new Blob([bytes], { type: getPostgresImageMimeType(imageStoragePath) });
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      })
      .catch(() => {
        if (active) setImageUrl("");
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectStoragePath, imageStoragePath]);

  return imageUrl;
}

function getObjectShapeMaskStyle(assetUrl: string): React.CSSProperties {
  return {
    WebkitMaskImage: `url("${assetUrl}")`,
    maskImage: `url("${assetUrl}")`,
    WebkitMaskSize: "100% 100%",
    maskSize: "100% 100%",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
  };
}

function ObjectShapeSwatch(props: {
  shape: PostgresObjectTypeShape;
  fill: PostgresObjectFill;
  color: string;
  sourceVisualKey?: PostgresSourceObjectVisualKey | null;
  imageStoragePath?: string;
  projectStoragePath?: string;
  width: number;
  minHeight: number;
  selected?: boolean;
  style?: React.CSSProperties;
}) {
  const {
    shape,
    fill,
    color,
    sourceVisualKey = null,
    imageStoragePath = "",
    projectStoragePath = "",
    width,
    minHeight,
    selected = false,
    style,
  } = props;
  const imageUrl = usePostgresStoredImageUrl(projectStoragePath, imageStoragePath);
  const hasUploadedImage = Boolean(imageStoragePath);
  const frameWidth = hasUploadedImage ? minHeight : width;
  const surfaceStyle = getPostgresObjectSurfaceStyle(color, fill, selected);
  const sourceOutlineAsset = sourceVisualKey ? POSTGRES_SOURCE_OBJECT_SHAPE_ASSET_URLS[sourceVisualKey] : null;
  const shapeAssets = sourceVisualKey ? null : POSTGRES_OBJECT_SHAPE_ASSET_URLS[shape];

  return (
    <span
      aria-hidden="true"
      style={{
        position: "relative",
        display: "inline-flex",
        width: frameWidth,
        height: minHeight,
        overflow: "hidden",
        flexShrink: 0,
        verticalAlign: "middle",
        lineHeight: 0,
        ...style,
      }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            background: "rgba(248, 250, 252, 0.94)",
            borderRadius: 6,
            border: `1px solid ${hexToRgba(color, selected ? 0.56 : 0.28)}`,
            boxSizing: "border-box",
          }}
        />
      ) : (
        <>
      <span
        style={{
          position: "absolute",
          inset: 0,
          display: "block",
          background: sourceOutlineAsset ? "transparent" : surfaceStyle.background,
          ...(sourceOutlineAsset
            ? {}
            : getObjectShapeMaskStyle(shapeAssets!.filled)),
        }}
      />
      <span
        style={{
          position: "absolute",
          inset: 0,
          display: "block",
          background: surfaceStyle.edgeColor,
          ...getObjectShapeMaskStyle(sourceOutlineAsset ?? shapeAssets!.outline),
        }}
      />
        </>
      )}
    </span>
  );
}

function PostgresRelationshipEndpointRestrictionColumn(props: {
  title: string;
  items: Array<{
    id: string;
    label: string;
    color?: string;
    shape?: PostgresObjectTypeShape;
    fill?: PostgresObjectFill;
    sourceVisualKey?: PostgresSourceObjectVisualKey | null;
    imageStoragePath?: string;
  }>;
  value: string[];
  onChange: (value: string[]) => void;
  projectStoragePath: string;
}) {
  const { title, items, value, onChange, projectStoragePath } = props;
  const selected = new Set(value);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{ fontWeight: 700, color: "#1f2933" }}>{title}</span>
          <span className="auth-hint" style={{ margin: 0 }}>
            {`${value.length} selected`}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className="btn btn--small"
            onClick={() => onChange(items.map((item) => item.id))}
          >
            All
          </button>
          <button
            type="button"
            className="btn btn--small"
            onClick={() => onChange([])}
          >
            Clear
          </button>
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gap: 8,
          maxHeight: 220,
          overflowY: "auto",
          padding: 10,
          borderRadius: 12,
          border: "1px solid rgba(53, 80, 112, 0.16)",
          background: "rgba(255, 255, 255, 0.94)",
        }}
      >
        {items.length === 0 ? (
          <p className="auth-hint" style={{ margin: 0 }}>No options available.</p>
        ) : items.map((item) => {
          const checked = selected.has(item.id);
          const accentColor = item.color || POSTGRES_RELATIONSHIP_DEFAULT_COLOR;
          const swatchShape = item.shape ?? "rounded";
          const swatchFill = item.fill ?? "outline";
          return (
            <label
              key={item.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 10px",
                borderRadius: 10,
                border: `1px solid ${checked ? hexToRgba(accentColor, 0.42) : "rgba(53, 80, 112, 0.12)"}`,
                background: checked
                  ? `linear-gradient(180deg, ${hexToRgba(accentColor, 0.12)}, rgba(255, 255, 255, 0.96))`
                  : "rgba(255, 255, 255, 0.88)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => {
                  if (event.target.checked) {
                    onChange(Array.from(new Set([...value, item.id])));
                    return;
                  }
                  onChange(value.filter((id) => id !== item.id));
                }}
              />
              <ObjectShapeSwatch
                shape={swatchShape}
                fill={swatchFill}
                color={accentColor}
                sourceVisualKey={item.sourceVisualKey ?? null}
                imageStoragePath={item.imageStoragePath ?? ""}
                projectStoragePath={projectStoragePath}
                width={28}
                minHeight={22}
                selected={checked}
              />
              <span style={{ fontWeight: 600, color: "#1f2933", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.label}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function PostgresObjectImageControls(props: {
  projectStoragePath: string;
  imageStoragePath: string;
  previewUrl?: string;
  graphicMode?: PostgresObjectGraphicMode;
  fallback: React.ReactNode;
  disabled: boolean;
  canUpload: boolean;
  onUpload?: () => void;
  onRemove?: () => void;
  onGraphicModeChange?: (mode: PostgresObjectGraphicMode) => void;
}) {
  const {
    projectStoragePath,
    imageStoragePath,
    previewUrl = "",
    graphicMode,
    fallback,
    disabled,
    canUpload,
    onUpload,
    onRemove,
    onGraphicModeChange,
  } = props;
  const imageUrl = usePostgresStoredImageUrl(projectStoragePath, imageStoragePath);
  const displayImageUrl = previewUrl || imageUrl;
  const uploadModeActive = graphicMode ? graphicMode === "upload" : true;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "112px minmax(0, 1fr)",
        gap: 14,
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: 112,
          maxWidth: 112,
          minHeight: 84,
          maxHeight: 112,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 10,
          border: "1px solid rgba(53, 80, 112, 0.14)",
          background: "rgba(248, 250, 252, 0.92)",
          overflow: "hidden",
        }}
      >
        {displayImageUrl ? (
          <img
            src={displayImageUrl}
            alt=""
            style={{
              display: "block",
              maxWidth: "100%",
              maxHeight: 112,
              width: "auto",
              height: "auto",
              objectFit: "contain",
            }}
          />
        ) : (
          fallback
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        {uploadModeActive ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn--small"
            onClick={onUpload}
            disabled={disabled || !canUpload || !onUpload}
          >
            {imageStoragePath || previewUrl ? "Replace image" : "Upload image"}
          </button>
          {imageStoragePath || previewUrl ? (
            <button
              type="button"
              className="btn btn--ghost-danger btn--small"
              onClick={onRemove}
              disabled={disabled || !canUpload || !onRemove}
            >
              Remove
            </button>
          ) : null}
          </div>
        ) : null}
        {uploadModeActive && !canUpload ? (
          <p className="auth-hint" style={{ margin: 0 }}>
            Save this record before adding an image.
          </p>
        ) : null}
      </div>
      {graphicMode && onGraphicModeChange ? (
        <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "center" }}>
          <div className="auth-tabs" role="tablist" aria-label="Object type graphic source" style={{ width: 220, marginBottom: 0 }}>
            <button
              type="button"
              role="tab"
              aria-selected={graphicMode === "select"}
              className={`auth-tab ${graphicMode === "select" ? "auth-tab--active" : ""}`}
              onClick={() => onGraphicModeChange("select")}
              disabled={disabled}
            >
              Select
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={graphicMode === "upload"}
              className={`auth-tab ${graphicMode === "upload" ? "auth-tab--active" : ""}`}
              onClick={() => onGraphicModeChange("upload")}
              disabled={disabled}
            >
              Upload
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PostgresImageCropModal(props: {
  draft: PostgresImageCropDraft;
  onDraftChange: (draft: PostgresImageCropDraft) => void;
  onCancel: () => void;
  onUseFullImage: () => void;
  onUseCrop: () => void;
  busy: boolean;
}) {
  const { draft, onDraftChange, onCancel, onUseFullImage, onUseCrop, busy } = props;
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [cropDragState, setCropDragState] = useState<PostgresImageCropDragState | null>(null);
  const cropFrameRef = useRef<HTMLDivElement | null>(null);
  const cropDisplay = imageDimensions
    ? (() => {
        const maxWidth = 420;
        const maxHeight = 360;
        const scale = Math.min(1, maxWidth / imageDimensions.width, maxHeight / imageDimensions.height);
        const width = Math.max(1, Math.round(imageDimensions.width * scale));
        const height = Math.max(1, Math.round(imageDimensions.height * scale));
        const crop = getPostgresCropRect(
          imageDimensions.width,
          imageDimensions.height,
          draft.aspect,
          draft.sizePercent,
          draft.xPercent,
          draft.yPercent,
        );
        return {
          width,
          height,
          scale,
          crop,
          cropStyle: {
            left: `${(crop.x / imageDimensions.width) * 100}%`,
            top: `${(crop.y / imageDimensions.height) * 100}%`,
            width: `${(crop.width / imageDimensions.width) * 100}%`,
            height: `${(crop.height / imageDimensions.height) * 100}%`,
          },
        };
      })()
    : null;

  useEffect(() => {
    let active = true;
    void loadPostgresImageElement(draft.upload.previewUrl)
      .then((image) => {
        if (active) setImageDimensions({ width: image.naturalWidth, height: image.naturalHeight });
      })
      .catch(() => {
        if (active) setImageDimensions(null);
      });
    return () => {
      active = false;
    };
  }, [draft.upload.previewUrl]);

  const updateDraft = (patch: Partial<PostgresImageCropDraft>) => {
    onDraftChange({ ...draft, ...patch, error: patch.error ?? "" });
  };

  useEffect(() => {
    if (!cropDragState) return;
    const handlePointerMove = (event: PointerEvent) => {
      const crop = getPostgresCropRect(
        cropDragState.imageWidth,
        cropDragState.imageHeight,
        draft.aspect,
        cropDragState.startSizePercent,
        cropDragState.startXPercent,
        cropDragState.startYPercent,
      );
      const dx = (event.clientX - cropDragState.startClientX) / cropDragState.displayScale;
      const dy = (event.clientY - cropDragState.startClientY) / cropDragState.displayScale;
      if (cropDragState.mode === "move") {
        const nextX = Math.min(Math.max(0, crop.x + dx), Math.max(0, cropDragState.imageWidth - crop.width));
        const nextY = Math.min(Math.max(0, crop.y + dy), Math.max(0, cropDragState.imageHeight - crop.height));
        updateDraft({
          xPercent: cropDragState.imageWidth === crop.width ? 50 : (nextX / (cropDragState.imageWidth - crop.width)) * 100,
          yPercent: cropDragState.imageHeight === crop.height ? 50 : (nextY / (cropDragState.imageHeight - crop.height)) * 100,
        });
        return;
      }

      const ratio = getPostgresCropAspectRatio(draft.aspect, cropDragState.imageWidth, cropDragState.imageHeight);
      const imageRatio = cropDragState.imageWidth / cropDragState.imageHeight;
      const maxCropWidth = imageRatio > ratio ? cropDragState.imageHeight * ratio : cropDragState.imageWidth;
      const maxCropHeight = imageRatio > ratio ? cropDragState.imageHeight : cropDragState.imageWidth / ratio;
      const handle = cropDragState.handle ?? "se";
      const xDirection = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0;
      const yDirection = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;
      const widthScale = xDirection === 0 ? crop.width / maxCropWidth : (crop.width + dx * xDirection) / maxCropWidth;
      const heightScale = yDirection === 0 ? crop.height / maxCropHeight : (crop.height + dy * yDirection) / maxCropHeight;
      const rawScale = xDirection !== 0 && yDirection !== 0
        ? Math.max(widthScale, heightScale)
        : xDirection !== 0
          ? widthScale
          : heightScale;
      const nextScale = Math.min(1, Math.max(0.2, rawScale));
      const nextWidth = maxCropWidth * nextScale;
      const nextHeight = maxCropHeight * nextScale;
      let nextX = crop.x;
      let nextY = crop.y;
      if (handle.includes("w")) {
        nextX = crop.x + crop.width - nextWidth;
      } else if (!handle.includes("e")) {
        nextX = crop.x + (crop.width - nextWidth) / 2;
      }
      if (handle.includes("n")) {
        nextY = crop.y + crop.height - nextHeight;
      } else if (!handle.includes("s")) {
        nextY = crop.y + (crop.height - nextHeight) / 2;
      }
      nextX = Math.min(Math.max(0, nextX), Math.max(0, cropDragState.imageWidth - nextWidth));
      nextY = Math.min(Math.max(0, nextY), Math.max(0, cropDragState.imageHeight - nextHeight));
      updateDraft({
        sizePercent: nextScale * 100,
        xPercent: cropDragState.imageWidth === nextWidth ? 50 : (nextX / (cropDragState.imageWidth - nextWidth)) * 100,
        yPercent: cropDragState.imageHeight === nextHeight ? 50 : (nextY / (cropDragState.imageHeight - nextHeight)) * 100,
      });
    };
    const handlePointerUp = () => setCropDragState(null);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [cropDragState, draft.aspect, draft, onDraftChange]);

  const startCropDrag = (
    event: React.PointerEvent,
    mode: PostgresImageCropDragState["mode"],
    handle?: PostgresImageCropResizeHandle,
  ) => {
    if (!imageDimensions || !cropDisplay || busy) return;
    event.preventDefault();
    event.stopPropagation();
    const frameBounds = cropFrameRef.current?.getBoundingClientRect();
    const displayScale = frameBounds ? frameBounds.width / imageDimensions.width : cropDisplay.scale;
    setCropDragState({
      mode,
      handle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startSizePercent: draft.sizePercent,
      startXPercent: draft.xPercent,
      startYPercent: draft.yPercent,
      imageWidth: imageDimensions.width,
      imageHeight: imageDimensions.height,
      displayScale,
    });
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 300 }} onClick={() => !busy && onCancel()}>
      <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
        <h2>Use image</h2>
        <p className="auth-hint" style={{ marginTop: 0 }}>
          Keep the full image or select a region to use for this object graphic.
        </p>
        <div className="auth-tabs" role="tablist" aria-label="Image region mode">
          <button
            type="button"
            className={`auth-tab ${draft.mode === "full" ? "auth-tab--active" : ""}`}
            onClick={() => updateDraft({ mode: "full" })}
            disabled={busy}
          >
            Full image
          </button>
          <button
            type="button"
            className={`auth-tab ${draft.mode === "crop" ? "auth-tab--active" : ""}`}
            onClick={() => updateDraft({
              mode: "crop",
              sizePercent: draft.sizePercent === 100 ? 80 : draft.sizePercent,
              xPercent: 50,
              yPercent: 50,
            })}
            disabled={busy}
          >
            Select region
          </button>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(220px, 0.8fr)",
            gap: 18,
            alignItems: "start",
          }}
        >
          <div
            style={{
              border: "1px solid rgba(53, 80, 112, 0.14)",
              borderRadius: 10,
              background: "rgba(248, 250, 252, 0.92)",
              padding: 12,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              minHeight: 220,
            }}
          >
            {draft.mode === "crop" && cropDisplay ? (
              <div
                ref={cropFrameRef}
                style={{
                  position: "relative",
                  width: `min(100%, ${cropDisplay.width}px)`,
                  aspectRatio: `${cropDisplay.width} / ${cropDisplay.height}`,
                  lineHeight: 0,
                  userSelect: "none",
                  touchAction: "none",
                  overflow: "hidden",
                  borderRadius: 8,
                }}
              >
                <img
                  src={draft.upload.previewUrl}
                  alt=""
                  draggable={false}
                  style={{
                    display: "block",
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    borderRadius: 8,
                  }}
                />
                <div
                  role="img"
                  aria-label="Selected image region"
                  onPointerDown={(event) => {
                    if (event.currentTarget === event.target) startCropDrag(event, "move");
                  }}
                  style={{
                    position: "absolute",
                    left: cropDisplay.cropStyle.left,
                    top: cropDisplay.cropStyle.top,
                    width: cropDisplay.cropStyle.width,
                    height: cropDisplay.cropStyle.height,
                    border: "2px solid #ffffff",
                    borderRadius: 6,
                    outline: "2px solid rgba(53, 80, 112, 0.82)",
                    boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.34), 0 10px 28px rgba(15, 23, 42, 0.22)",
                    cursor: busy ? "default" : "move",
                    boxSizing: "border-box",
                    background: "rgba(255, 255, 255, 0.03)",
                    touchAction: "none",
                  }}
                >
                  {[
                    ["nw", { left: -7, top: -7, cursor: "nwse-resize" }],
                    ["n", { left: "50%", top: -7, transform: "translateX(-50%)", cursor: "ns-resize" }],
                    ["ne", { right: -7, top: -7, cursor: "nesw-resize" }],
                    ["w", { left: -7, top: "50%", transform: "translateY(-50%)", cursor: "ew-resize" }],
                    ["e", { right: -7, top: "50%", transform: "translateY(-50%)", cursor: "ew-resize" }],
                    ["sw", { left: -7, bottom: -7, cursor: "nesw-resize" }],
                    ["s", { left: "50%", bottom: -7, transform: "translateX(-50%)", cursor: "ns-resize" }],
                    ["se", { right: -7, bottom: -7, cursor: "nwse-resize" }],
                  ].map(([handle, style]) => (
                    <span
                      key={handle as string}
                      aria-hidden="true"
                      onPointerDown={(event) => startCropDrag(
                        event,
                        "resize",
                        handle as PostgresImageCropResizeHandle,
                      )}
                      style={{
                        position: "absolute",
                        width: 14,
                        height: 14,
                        borderRadius: 999,
                        background: "#fff",
                        border: "1px solid rgba(53, 80, 112, 0.5)",
                        boxShadow: "0 2px 8px rgba(15, 23, 42, 0.22)",
                        cursor: busy ? "default" : (style as React.CSSProperties).cursor,
                        ...(style as React.CSSProperties),
                      }}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <img
                src={draft.upload.previewUrl}
                alt=""
                style={{
                  display: "block",
                  maxWidth: "100%",
                  maxHeight: 360,
                  width: "auto",
                  height: "auto",
                  borderRadius: 8,
                }}
              />
            )}
          </div>
          <div className="form" style={{ gap: 12 }}>
            <p className="auth-hint" style={{ margin: 0 }}>
              {draft.upload.originalFileName} - {formatPostgresFileSize(draft.upload.fileSizeBytes)}
            </p>
            {imageDimensions ? (
              <p className="auth-hint" style={{ margin: 0 }}>
                {imageDimensions.width} x {imageDimensions.height}px
              </p>
            ) : null}
            {draft.mode === "crop" ? (
              <>
                <label className="form-label">
                  Aspect
                  <select
                    className="form-input"
                    value={draft.aspect}
                    onChange={(event) => updateDraft({
                      aspect: event.target.value as PostgresImageCropAspect,
                      sizePercent: 100,
                      xPercent: 50,
                      yPercent: 50,
                    })}
                    disabled={busy}
                  >
                    <option value="original">Original</option>
                    <option value="1:1">Square</option>
                    <option value="4:3">4:3</option>
                    <option value="16:9">16:9</option>
                  </select>
                </label>
                <p className="auth-hint" style={{ margin: 0 }}>
                  Drag the box to move it. Drag the corner handle to resize it.
                </p>
              </>
            ) : (
              <p className="auth-hint" style={{ margin: 0 }}>
                The original file will be uploaded without cropping.
              </p>
            )}
            {draft.error ? <p className="modal-warning-text" style={{ margin: 0 }}>{draft.error}</p> : null}
          </div>
        </div>
        <div className="form-actions" style={{ marginTop: 24 }}>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          {draft.mode === "full" ? (
            <button type="button" className="btn btn--primary" onClick={onUseFullImage} disabled={busy}>
              Use full image
            </button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={onUseCrop} disabled={busy}>
              {busy ? "Cropping..." : "Use selected region"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function formatRelationshipTypeConstraintSummary(relationshipType: {
  fromObjectTypes?: string[];
  toObjectTypes?: string[];
  fromObjectTypeIds?: string[];
  toObjectTypeIds?: string[];
}): string {
  const fromLabels = relationshipType.fromObjectTypeIds?.length
    ? (relationshipType.fromObjectTypes?.length ? relationshipType.fromObjectTypes : ["Unknown type"])
    : [];
  const toLabels = relationshipType.toObjectTypeIds?.length
    ? (relationshipType.toObjectTypes?.length ? relationshipType.toObjectTypes : ["Unknown type"])
    : [];
  const fromLabel = fromLabels.length ? fromLabels.join(", ") : "Any object type";
  const toLabel = toLabels.length ? toLabels.join(", ") : "Any object type";
  if (!fromLabels.length && !toLabels.length) {
    return "Unrestricted";
  }
  return `From ${fromLabel} to ${toLabel}`;
}

function parsePostgresRelationshipEndpointKey(
  key: string,
): { entityType: "object" | "source"; entityId: string } | null {
  const [entityType, ...idParts] = key.split(":");
  const entityId = idParts.join(":");
  if ((entityType !== "object" && entityType !== "source") || !entityId) return null;
  return { entityType, entityId };
}

function normalizePostgresSourceKind(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/^source_/, "").replace(/_/g, " ");
  return normalized === "processed transcript" ? "transcript" : normalized;
}

function postgresRelationshipTypeAllowsSourceEndpoint(
  relationshipType: PostgresRelationshipType,
  endpoint: "from" | "to",
  sourceKind: string,
): boolean {
  const objectTypeIds = endpoint === "from" ? relationshipType.fromObjectTypeIds : relationshipType.toObjectTypeIds;
  const sourceKinds = endpoint === "from" ? relationshipType.fromSourceKinds : relationshipType.toSourceKinds;
  if (sourceKinds.length > 0) {
    const normalizedSourceKind = normalizePostgresSourceKind(sourceKind);
    return sourceKinds.some((allowed) => normalizePostgresSourceKind(allowed) === normalizedSourceKind);
  }
  return objectTypeIds.length === 0;
}

function postgresRelationshipTypeAllowsObjectEndpoint(
  relationshipType: PostgresRelationshipType,
  endpoint: "from" | "to",
  objectTypeId: string,
): boolean {
  const objectTypeIds = endpoint === "from" ? relationshipType.fromObjectTypeIds : relationshipType.toObjectTypeIds;
  const sourceKinds = endpoint === "from" ? relationshipType.fromSourceKinds : relationshipType.toSourceKinds;
  if (objectTypeIds.length > 0) return objectTypeIds.includes(objectTypeId);
  return sourceKinds.length === 0;
}

function PostgresRelationshipEndpointSingleSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: PostgresRelationshipEndpointOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="form-label">
      {label}
      <div className="users-table-wrap" style={{ maxHeight: 188, overflowY: "auto", marginTop: 6 }}>
        <table className="users-table">
          <thead>
            <tr>
              <th className="users-th" style={{ width: "62%" }}>Name</th>
              <th className="users-th" style={{ width: "38%" }}>Type</th>
            </tr>
          </thead>
          <tbody>
            {options.length === 0 ? (
              <tr>
                <td className="users-td-msg" colSpan={2}>No matching endpoints.</td>
              </tr>
            ) : options.map((option) => (
              <tr
                key={option.key}
                className="users-row"
                style={{
                  background: value === option.key ? "rgba(53, 80, 112, 0.10)" : undefined,
                  cursor: "pointer",
                }}
                onClick={() => onChange(option.key)}
              >
                <td className="users-td users-td--name">{option.name}</td>
                <td className="users-td users-td--muted">{option.type}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </label>
  );
}

function normalizePostgresRelationshipRestrictionSelection(selection: string[], allIds: string[]): string[] {
  if (allIds.length > 0 && selection.length === allIds.length) {
    const selected = new Set(selection);
    if (allIds.every((id) => selected.has(id))) {
      return [];
    }
  }
  return selection;
}

function expandPostgresRelationshipRestrictionSelection(selection: string[] | undefined, allIds: string[]): string[] {
  return selection && selection.length > 0 ? selection : allIds;
}

function formatPostgresAttributeDisplay(
  value: string,
  dataType: PostgresObjectAttributeDefinition["dataType"],
): string {
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

function areCanvasNodeMapsEqual(
  left: Record<string, PostgresCanvasNodeState>,
  right: Record<string, PostgresCanvasNodeState>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    const leftNode = left[key];
    const rightNode = right[key];
    if (!rightNode) return false;
    if (
      leftNode.id !== rightNode.id
      || leftNode.x !== rightNode.x
      || leftNode.y !== rightNode.y
      || leftNode.width !== rightNode.width
      || leftNode.height !== rightNode.height
    ) {
      return false;
    }
  }
  return true;
}

function formatPostgresDateTime(iso: string): string {
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

function formatCanvasKindLabel(kind: string): string {
  switch (kind) {
    case "free_draw":
      return "Free Draw";
    case "explore":
      return "Explore";
    case "construct":
      return "Construct";
    default:
      return kind;
  }
}

type PostgresSavedCanvasSession = {
  id: string;
  name: string;
  canvasKind: "free_draw" | "explore" | "construct";
  mode: "view" | "edit";
};

let jsPdfPromise: Promise<typeof import("jspdf")> | null = null;
let svgToPdfPromise: Promise<typeof import("svg2pdf.js")> | null = null;

async function loadJsPdf() {
  if (!jsPdfPromise) {
    jsPdfPromise = import("jspdf");
  }
  return jsPdfPromise;
}

async function loadSvgToPdf() {
  if (!svgToPdfPromise) {
    svgToPdfPromise = import("svg2pdf.js");
  }
  return svgToPdfPromise;
}

function createTypeAttributeDraft(draft?: Partial<SharedAttributeDraft> & { id?: string }): TypeAttributeDraft {
  return {
    localId: `${draft?.id ?? "new"}-${Math.random().toString(36).slice(2, 10)}`,
    ...(draft?.id ? { id: draft.id } : {}),
    name: draft?.name ?? "",
    dataType: draft?.dataType ?? "text",
    description: draft?.description ?? "",
    options: draft?.options ?? [],
  };
}

function normalizeAttributeModalOptions(options: string[]): string[] {
  return options.map((option) => option.trim()).filter(Boolean);
}

function TypeScopedAttributeModal({
  draft,
  typeOptions,
  title,
  typeLabel,
  saving,
  error,
  onCancel,
  onSave,
}: {
  draft: TypeScopedAttributeDraft;
  typeOptions: Array<{ id: string; label: string; count: number }>;
  title: string;
  typeLabel: string;
  saving: boolean;
  error?: string;
  onCancel: () => void;
  onSave: (draft: TypeScopedAttributeDraft) => void;
}) {
  const [name, setName] = useState(draft.name);
  const [dataType, setDataType] = useState<SharedAttributeDraft["dataType"]>(draft.dataType);
  const [description, setDescription] = useState(draft.description);
  const [options, setOptions] = useState<string[]>(draft.options.length > 0 ? draft.options : ["", ""]);
  const [typeIds, setTypeIds] = useState<string[]>(draft.typeIds);
  const normalizedOptions = normalizeAttributeModalOptions(options);
  const dataTypeOptions: Array<{ value: SharedAttributeDraft["dataType"]; label: string }> = [
    { value: "text", label: "Text" },
    { value: "number", label: "Number" },
    { value: "datetime", label: "Date/time" },
    { value: "categorical", label: "Categorical" },
  ];

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        <div className="attribute-values-details">
          <label className="form-group">
            <span className="form-label">Attribute name</span>
            <input className="form-input" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <div className="form-group attribute-details-span">
            <span className="form-label">Data type</span>
            <div className="attribute-type-picker">
              {dataTypeOptions.map((option) => (
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
            <span className="form-label">Description</span>
            <textarea
              className="form-input attribute-description-input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
            />
          </label>
          {dataType === "categorical" ? (
            <div className="form-group attribute-details-span">
              <span className="form-label">Categories</span>
              <div className="attribute-category-list">
                {options.map((option, index) => (
                  <input
                    key={index}
                    className="form-input"
                    value={option}
                    onChange={(event) => setOptions((current) => current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))}
                    placeholder={`Category ${index + 1}`}
                  />
                ))}
              </div>
              <button type="button" className="btn btn--small" onClick={() => setOptions((current) => [...current, ""])}>
                Add more
              </button>
            </div>
          ) : null}
        </div>
        <div className="attribute-values-list">
          {typeOptions.length === 0 ? (
            <p className="case-card-empty">No {typeLabel.toLowerCase()} types yet.</p>
          ) : (
            typeOptions.map((option) => (
              <label key={option.id} className="attribute-value-row">
                <span>{option.label}</span>
                <input
                  type="checkbox"
                  checked={typeIds.includes(option.id)}
                  onChange={(event) => {
                    setTypeIds((current) => event.target.checked
                      ? [...current, option.id]
                      : current.filter((id) => id !== option.id));
                  }}
                />
              </label>
            ))
          )}
        </div>
        {error ? <div className="form-error" style={{ marginTop: 16 }}>{error}</div> : null}
        <div className="form-actions" style={{ marginTop: 20 }}>
          <button className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
          <button
            className="btn btn--primary"
            onClick={() => onSave({
              ...draft,
              name: name.trim(),
              dataType,
              description: description.trim(),
              options: normalizedOptions,
              typeIds,
            })}
            disabled={saving || !name.trim() || typeIds.length === 0 || (dataType === "categorical" && normalizedOptions.length < 2)}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PostgresStatCard({
  title,
  count,
  stats,
  onClick,
}: {
  title: string;
  count: string | number | null;
  stats: { label: string; value: string | number }[];
  onClick: () => void;
}) {
  return (
    <div className="home-stat-card" onClick={onClick}>
      <div className="home-stat-title">{title}</div>
      <div className="home-stat-count">{count ?? "-"}</div>
      <div className="home-stat-details">
        {stats.map((stat) => (
          <div key={`${title}-${stat.label}`} className="home-stat-row">
            <span className="home-stat-label">{stat.label}</span>
            <span className="home-stat-value">{stat.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PostgresProjectHomeView({
  project,
  authSession,
  onAuthSessionUpdated,
  onAuthSessionInvalidated,
  onBack,
  onProjectUpdated,
  onProjectDeleted,
  onSignOut,
}: PostgresProjectHomeViewProps) {
  const PROJECT_ROLE_OPTIONS = ["owner", "editor", "coder", "viewer"] as const;
  const [activeScreen, setActiveScreen] = useState<PostgresProjectScreen>("home");
  const [postgresSourceNavigationTarget, setPostgresSourceNavigationTarget] = useState<{
    sourceId: string;
    annotationId: string | null;
    textSegment: { startOffset: number; endOffset: number } | null;
  } | null>(null);
  const [postgresAnnotationNavigationTargetId, setPostgresAnnotationNavigationTargetId] = useState<string | null>(null);
  const [postgresMemoDraftTarget, setPostgresMemoDraftTarget] = useState<PostgresMemoDraftTarget | null>(null);
  const [users, setUsers] = useState<PostgresProjectUser[]>([]);
  const [appUsers, setAppUsers] = useState<PostgresAppUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersSubmitting, setUsersSubmitting] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [userNotice, setUserNotice] = useState("");
  const [selectedUserRoleFilter, setSelectedUserRoleFilter] = useState<(typeof PROJECT_ROLE_OPTIONS)[number] | "all">("all");
  const [selectedAppUserId, setSelectedAppUserId] = useState("");
  const [userRole, setUserRole] = useState<(typeof PROJECT_ROLE_OPTIONS)[number]>("coder");
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<(typeof PROJECT_ROLE_OPTIONS)[number]>("coder");
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [objectTypes, setObjectTypes] = useState<PostgresObjectType[]>([]);
  const [objects, setObjects] = useState<PostgresObject[]>([]);
  const [sources, setSources] = useState<PostgresSource[]>([]);
  const [objectAttributeDefinitions, setObjectAttributeDefinitions] = useState<PostgresObjectAttributeDefinition[]>([]);
  const [relationships, setRelationships] = useState<PostgresRelationship[]>([]);
  const [relationshipAttributeDefinitions, setRelationshipAttributeDefinitions] = useState<PostgresRelationshipAttributeDefinition[]>([]);
  const [savedDrawings, setSavedDrawings] = useState<PostgresSavedDrawingSummary[]>([]);
  const [savedCanvasSession, setSavedCanvasSession] = useState<PostgresSavedCanvasSession | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphSubmitting, setGraphSubmitting] = useState(false);
  const [graphError, setGraphError] = useState("");
  const [graphNotice, setGraphNotice] = useState("");
  const [relationshipAttributeEditorDraft, setRelationshipAttributeEditorDraft] = useState<PostgresRelationshipAttributeDraft | null>(null);
  const [relationshipAttributeEditorError, setRelationshipAttributeEditorError] = useState("");
  const [objectWorkspaceAttributeDraft, setObjectWorkspaceAttributeDraft] = useState<TypeScopedAttributeDraft | null>(null);
  const [objectWorkspaceAttributeError, setObjectWorkspaceAttributeError] = useState("");
  const [relationshipWorkspaceAttributeDraft, setRelationshipWorkspaceAttributeDraft] = useState<TypeScopedAttributeDraft | null>(null);
  const [relationshipWorkspaceAttributeError, setRelationshipWorkspaceAttributeError] = useState("");
  const [relationshipTypeAttributeDrafts, setRelationshipTypeAttributeDrafts] = useState<TypeAttributeDraft[]>([]);
  const [relationshipTypeAttributeModalDraft, setRelationshipTypeAttributeModalDraft] = useState<TypeAttributeDraft | null>(null);
  const [typeAttributeModalError, setTypeAttributeModalError] = useState("");
  const [objectTypeId, setObjectTypeId] = useState("");
  const [objectTitle, setObjectTitle] = useState("");
  const [objectDescription, setObjectDescription] = useState("");
  const [objectShapeOverride, setObjectShapeOverride] = useState("");
  const [objectColorOverride, setObjectColorOverride] = useState("");
  const [objectFillOverride, setObjectFillOverride] = useState("");
  const [objectAttributeValues, setObjectAttributeValues] = useState<Record<string, string>>({});
  const [draftObjectPendingImage, setDraftObjectPendingImage] = useState<PostgresImageUploadDraft | null>(null);
  const [selectedObjectTypeFilter, setSelectedObjectTypeFilter] = useState<string>("all");
  const [selectedObjectDetailsId, setSelectedObjectDetailsId] = useState<string | null>(null);
  const [selectedRelationshipDetailsId, setSelectedRelationshipDetailsId] = useState<string | null>(null);
  const [attributeHistoryTarget, setAttributeHistoryTarget] = useState<PostgresAttributeValueHistoryTarget | null>(null);
  const [detailAttributeHistoryTarget, setDetailAttributeHistoryTarget] = useState<PostgresAttributeValueHistoryTarget | null>(null);
  const [activeObjectAttributeHistoryCell, setActiveObjectAttributeHistoryCell] = useState<{
    objectId: string;
    attributeDefinitionId: string;
  } | null>(null);
  const [activeRelationshipAttributeHistoryCell, setActiveRelationshipAttributeHistoryCell] = useState<{
    relationshipId: string;
    attributeDefinitionId: string;
  } | null>(null);
  const [showObjectAttributesTable, setShowObjectAttributesTable] = useState(false);
  const [showRelationshipAttributesTable, setShowRelationshipAttributesTable] = useState(false);
  const [objectTypeSortCol, setObjectTypeSortCol] = useState<PostgresObjectTypeSortCol>("objectType");
  const [objectTypeSortDir, setObjectTypeSortDir] = useState<"asc" | "desc">("asc");
  const [objectAttributeSortCol, setObjectAttributeSortCol] = useState<"name" | string>("name");
  const [objectAttributeSortDir, setObjectAttributeSortDir] = useState<"asc" | "desc">("asc");
  const [relationshipAttributeSortCol, setRelationshipAttributeSortCol] = useState<"name" | string>("name");
  const [relationshipAttributeSortDir, setRelationshipAttributeSortDir] = useState<"asc" | "desc">("asc");
  const [openObjectTypeActionsMenu, setOpenObjectTypeActionsMenu] = useState<{
    id: string;
    left: number;
    top: number;
  } | null>(null);
  const [createObjectOpen, setCreateObjectOpen] = useState(false);
  const [createObjectTypeOpen, setCreateObjectTypeOpen] = useState(false);
  const [editingObjectTypeModalId, setEditingObjectTypeModalId] = useState<string | null>(null);
  const [removingObjectTypeId, setRemovingObjectTypeId] = useState<string | null>(null);
  const [draftObjectTypeName, setDraftObjectTypeName] = useState("");
  const [draftObjectTypeDescription, setDraftObjectTypeDescription] = useState("");
  const [draftObjectTypeShape, setDraftObjectTypeShape] = useState<PostgresObjectTypeShape>("rounded");
  const [draftObjectTypeColor, setDraftObjectTypeColor] = useState(POSTGRES_OBJECT_TYPE_DEFAULT_COLOR);
  const [draftObjectTypeFill, setDraftObjectTypeFill] = useState<PostgresObjectFill>("filled");
  const [draftObjectTypeImageStoragePath, setDraftObjectTypeImageStoragePath] = useState("");
  const [draftObjectTypePendingImage, setDraftObjectTypePendingImage] = useState<PostgresImageUploadDraft | null>(null);
  const [draftObjectTypeGraphicMode, setDraftObjectTypeGraphicMode] = useState<PostgresObjectGraphicMode>("select");
  const [objectTypeModalTab, setObjectTypeModalTab] = useState<"details" | "graphics" | "attributes">("details");
  const [createObjectModalTab, setCreateObjectModalTab] = useState<"details" | "graphics" | "attributes">("details");
  const [objectTypeAttributeDrafts, setObjectTypeAttributeDrafts] = useState<TypeAttributeDraft[]>([]);
  const [objectTypeAttributeModalDraft, setObjectTypeAttributeModalDraft] = useState<TypeAttributeDraft | null>(null);
  const [editingObjectId, setEditingObjectId] = useState<string | null>(null);
  const [editObjectModalTab, setEditObjectModalTab] = useState<"details" | "graphics" | "attributes">("details");
  const [editingObjectTypeId, setEditingObjectTypeId] = useState("");
  const [editingObjectTitle, setEditingObjectTitle] = useState("");
  const [editingObjectDescription, setEditingObjectDescription] = useState("");
  const [editingObjectShapeOverride, setEditingObjectShapeOverride] = useState("");
  const [editingObjectColorOverride, setEditingObjectColorOverride] = useState("");
  const [editingObjectFillOverride, setEditingObjectFillOverride] = useState("");
  const [objectImageStoragePath, setObjectImageStoragePath] = useState("");
  const [editingObjectImageStoragePath, setEditingObjectImageStoragePath] = useState("");
  const [objectGraphicMode, setObjectGraphicMode] = useState<PostgresObjectInstanceGraphicMode>("inherit");
  const [editingObjectGraphicMode, setEditingObjectGraphicMode] = useState<PostgresObjectInstanceGraphicMode>("inherit");
  const [imageUploadSubmitting, setImageUploadSubmitting] = useState(false);
  const [imageCropSubmitting, setImageCropSubmitting] = useState(false);
  const [imageCropDraft, setImageCropDraft] = useState<PostgresImageCropDraft | null>(null);
  const [editingObjectAttributeValues, setEditingObjectAttributeValues] = useState<Record<string, string>>({});
  const [removingObjectId, setRemovingObjectId] = useState<string | null>(null);
  const [openObjectActionsMenu, setOpenObjectActionsMenu] = useState<{
    id: string;
    left: number;
    top: number;
  } | null>(null);
  const [fromObjectId, setFromObjectId] = useState("");
  const [toObjectId, setToObjectId] = useState("");
  const [relationshipTypes, setRelationshipTypes] = useState<PostgresRelationshipType[]>([]);
  const [createRelationshipTypeOpen, setCreateRelationshipTypeOpen] = useState(false);
  const [editingRelationshipTypeModalId, setEditingRelationshipTypeModalId] = useState<string | null>(null);
  const [removingRelationshipTypeId, setRemovingRelationshipTypeId] = useState<string | null>(null);
  const [draftRelationshipTypeName, setDraftRelationshipTypeName] = useState("");
  const [draftRelationshipLineShape, setDraftRelationshipLineShape] = useState<PostgresRelationshipLineShape>("solid");
  const [draftRelationshipLineWeight, setDraftRelationshipLineWeight] = useState(2);
  const [draftRelationshipArrowhead, setDraftRelationshipArrowhead] = useState<PostgresRelationshipArrowhead>("one_sided");
  const [draftRelationshipColor, setDraftRelationshipColor] = useState(POSTGRES_RELATIONSHIP_DEFAULT_COLOR);
  const [selectedRelationshipTypeFilter, setSelectedRelationshipTypeFilter] = useState<string>("all");
  const [selectedCanvasViewKind, setSelectedCanvasViewKind] = useState<"free_draw" | "explore" | "construct">("free_draw");
  const [openSavedDrawingActionsMenu, setOpenSavedDrawingActionsMenu] = useState<{
    id: string;
    left: number;
    top: number;
  } | null>(null);
  const [exportingSavedDrawingId, setExportingSavedDrawingId] = useState<string | null>(null);
  const [savedDrawingExportBusyFormat, setSavedDrawingExportBusyFormat] = useState<"png" | "pdf" | null>(null);
  const [removingSavedDrawingId, setRemovingSavedDrawingId] = useState<string | null>(null);
  const [relationshipTypeSearchTerm, setRelationshipTypeSearchTerm] = useState("");
  const [openRelationshipTypeActionsMenu, setOpenRelationshipTypeActionsMenu] = useState<{
    id: string;
    left: number;
    top: number;
  } | null>(null);
  const [openRelationshipActionsMenu, setOpenRelationshipActionsMenu] = useState<{
    id: string;
    left: number;
    top: number;
  } | null>(null);
  const [draftRelationshipFromObjectTypeIds, setDraftRelationshipFromObjectTypeIds] = useState<string[]>([]);
  const [draftRelationshipToObjectTypeIds, setDraftRelationshipToObjectTypeIds] = useState<string[]>([]);
  const [draftRelationshipFromSourceKinds, setDraftRelationshipFromSourceKinds] = useState<string[]>([]);
  const [draftRelationshipToSourceKinds, setDraftRelationshipToSourceKinds] = useState<string[]>([]);
  const [relationshipTypeModalTab, setRelationshipTypeModalTab] = useState<"details" | "object1" | "object2" | "attributes">("details");
  const [relationshipTypeId, setRelationshipTypeId] = useState("");
  const [relationshipDescription, setRelationshipDescription] = useState("");
  const [relationshipLineShapeOverride, setRelationshipLineShapeOverride] = useState("");
  const [relationshipLineWeightOverride, setRelationshipLineWeightOverride] = useState<number | null>(null);
  const [relationshipArrowheadOverride, setRelationshipArrowheadOverride] = useState("");
  const [relationshipColorOverride, setRelationshipColorOverride] = useState("");
  const [relationshipAttributeValues, setRelationshipAttributeValues] = useState<Record<string, string>>({});
  const [createRelationshipOpen, setCreateRelationshipOpen] = useState(false);
  const [createRelationshipModalTab, setCreateRelationshipModalTab] = useState<"details" | "graphics" | "attributes">("details");
  const [editingRelationshipId, setEditingRelationshipId] = useState<string | null>(null);
  const [editRelationshipModalTab, setEditRelationshipModalTab] = useState<"details" | "graphics" | "attributes">("details");
  const [editingRelationshipFromObjectId, setEditingRelationshipFromObjectId] = useState("");
  const [editingRelationshipToObjectId, setEditingRelationshipToObjectId] = useState("");
  const [editingRelationshipTypeId, setEditingRelationshipTypeId] = useState("");
  const [editingRelationshipDescription, setEditingRelationshipDescription] = useState("");
  const [editingRelationshipLineShapeOverride, setEditingRelationshipLineShapeOverride] = useState("");
  const [editingRelationshipLineWeightOverride, setEditingRelationshipLineWeightOverride] = useState<number | null>(null);
  const [editingRelationshipArrowheadOverride, setEditingRelationshipArrowheadOverride] = useState("");
  const [editingRelationshipColorOverride, setEditingRelationshipColorOverride] = useState("");
  const [editingRelationshipAttributeValues, setEditingRelationshipAttributeValues] = useState<Record<string, string>>({});
  const [removingRelationshipId, setRemovingRelationshipId] = useState<string | null>(null);
  const [editingRelationshipAttributeTypeId, setEditingRelationshipAttributeTypeId] = useState<string | null>(null);
  const [canvasTool, setCanvasTool] = useState<PostgresCanvasTool>("select");
  const [canvasScale, setCanvasScale] = useState(1);
  const [canvasOffset, setCanvasOffset] = useState<PostgresCanvasPoint>({ x: 140, y: 120 });
  const [canvasNodes, setCanvasNodes] = useState<Record<string, PostgresCanvasNodeState>>({});
  const [canvasShapes, setCanvasShapes] = useState<PostgresCanvasShape[]>([]);
  const [hiddenCanvasRelationshipIds, setHiddenCanvasRelationshipIds] = useState<string[]>([]);
  const [canvasRelationshipTypeId, setCanvasRelationshipTypeId] = useState("");
  const [canvasStateLoaded, setCanvasStateLoaded] = useState(false);
  const [canvasSaveError, setCanvasSaveError] = useState("");
  const [freeDrawSaveNotice, setFreeDrawSaveNotice] = useState("");
  const [freeDrawSaving, setFreeDrawSaving] = useState(false);
  const [freeDrawSavedDrawingId, setFreeDrawSavedDrawingId] = useState<string | null>(null);
  const [saveFreeDrawModalOpen, setSaveFreeDrawModalOpen] = useState(false);
  const [saveFreeDrawName, setSaveFreeDrawName] = useState("");
  const [pendingCanvasNodePosition, setPendingCanvasNodePosition] = useState<PostgresCanvasPoint | null>(null);
  const pendingLocalGraphRefreshSkipsRef = useRef(0);
  const imageCropResolverRef = useRef<((upload: PostgresImageUploadDraft | null) => void) | null>(null);
  const objectById = new Map(objects.map((object) => [object.id, object]));
  const objectTypeById = new Map(objectTypes.map((objectType) => [objectType.id, objectType]));
  const relationshipTypeById = new Map(relationshipTypes.map((relationshipType) => [relationshipType.id, relationshipType]));
  const customObjects = useMemo(
    () => objects,
    [objects],
  );
  const customObjectTypes = useMemo(
    () => objectTypes,
    [objectTypes],
  );
  const customObjectTypeIds = useMemo(
    () => new Set(customObjectTypes.map((objectType) => objectType.id)),
    [customObjectTypes],
  );
  const allObjectTypeIds = useMemo(
    () => objectTypes.map((objectType) => objectType.id),
    [objectTypes],
  );
  const allSourceKindIds = useMemo(
    () => POSTGRES_SOURCE_KIND_OPTIONS.map((sourceKind) => sourceKind.id),
    [],
  );
  const selectedCreateObjectType = objectTypeById.get(objectTypeId) ?? null;
  const selectedEditObjectType = objectTypeById.get(editingObjectTypeId) ?? null;
  useEffect(() => {
    return () => {
      if (draftObjectTypePendingImage?.previewUrl) {
        URL.revokeObjectURL(draftObjectTypePendingImage.previewUrl);
      }
    };
  }, [draftObjectTypePendingImage]);
  useEffect(() => {
    return () => {
      if (draftObjectPendingImage?.previewUrl) {
        URL.revokeObjectURL(draftObjectPendingImage.previewUrl);
      }
    };
  }, [draftObjectPendingImage]);
  const relationshipAttributeRows = relationships
    .filter((relationship) => !editingRelationshipAttributeTypeId || relationship.relationshipTypeId === editingRelationshipAttributeTypeId)
    .map((relationship) => ({
    id: relationship.id,
    name: relationship.relationshipType,
  }));
  const objectTypeSummaries = useMemo(
    () => customObjectTypes
      .map((objectTypeRecord) => {
        const matchingObjects = customObjects.filter(
          (object) => object.objectTypeId === objectTypeRecord.id,
        );
        const matchingDefinitions = objectAttributeDefinitions.filter(
          (definition) => definition.objectTypeId === objectTypeRecord.id,
        );
        const lastUpdatedAt = [
          objectTypeRecord.updatedAt,
          ...matchingObjects.map((object) => object.updatedAt),
          ...matchingDefinitions.map((definition) => definition.updatedAt),
        ]
          .filter(Boolean)
          .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? objectTypeRecord.createdAt;
        return {
          objectTypeId: objectTypeRecord.id,
          systemKey: objectTypeRecord.systemKey,
          objectType: objectTypeRecord.name,
          description: objectTypeRecord.description,
          shape: objectTypeRecord.shape,
          color: objectTypeRecord.color,
          fill: objectTypeRecord.fill,
          imageStoragePath: objectTypeRecord.imageStoragePath,
          count: matchingObjects.length,
          describedCount: matchingObjects.filter((object) => object.description.trim()).length,
          attributedCount: matchingObjects.filter((object) => object.attributeValues.some((value) => value.value.trim())).length,
          attributeDefinitionCount: matchingDefinitions.length,
          lastUpdatedAt,
        };
      })
      .sort((left, right) => {
        let comparison = 0;
        if (objectTypeSortCol === "count") {
          comparison = left.count - right.count;
        } else {
          comparison = left.objectType.localeCompare(right.objectType, undefined, { sensitivity: "base" });
        }
        if (comparison === 0) {
          comparison = left.objectType.localeCompare(right.objectType, undefined, { sensitivity: "base" });
        }
        return objectTypeSortDir === "asc" ? comparison : -comparison;
      }),
    [customObjectTypes, customObjects, objectAttributeDefinitions, objectTypeSortCol, objectTypeSortDir],
  );
  const objectWorkspaceAttributeTypeOptions = useMemo(
    () => objectTypeSummaries.map((summary) => ({
      id: summary.objectTypeId,
      label: summary.objectType,
      count: summary.count,
    })),
    [objectTypeSummaries],
  );
  const resetFreeDrawCanvasSession = useCallback(() => {
    setCanvasScale(1);
    setCanvasOffset({ x: 140, y: 120 });
    setCanvasNodes({});
    setCanvasShapes([]);
    setHiddenCanvasRelationshipIds([]);
    setCanvasSaveError("");
    setFreeDrawSaveNotice("");
    setFreeDrawSavedDrawingId(null);
  }, []);

  const clearSavedCanvasSession = useCallback(() => {
    setSavedCanvasSession(null);
    setFreeDrawSavedDrawingId(null);
  }, []);

  const openSaveFreeDrawModal = useCallback(() => {
    setCanvasSaveError("");
    setFreeDrawSaveNotice("");
    setSaveFreeDrawName(savedCanvasSession?.name ?? "");
    setSaveFreeDrawModalOpen(true);
  }, [savedCanvasSession?.name]);

  const handleSaveFreeDrawCanvas = useCallback(async () => {
    const trimmedName = saveFreeDrawName.trim();
    if (!trimmedName) {
      setCanvasSaveError("Enter a name for the saved canvas.");
      return;
    }
    setFreeDrawSaving(true);
    setCanvasSaveError("");
    setFreeDrawSaveNotice("");
    try {
      const saved = await savePostgresSavedDrawing({
        projectId: project.id,
        drawingId: freeDrawSavedDrawingId,
        name: trimmedName,
        canvasKind: "free_draw",
        state: {
          viewport: {
            x: canvasOffset.x,
            y: canvasOffset.y,
            zoom: canvasScale,
          },
          nodes: Object.values(canvasNodes),
          shapes: canvasShapes,
          hiddenRelationshipIds: hiddenCanvasRelationshipIds,
        },
      });
      setFreeDrawSavedDrawingId(saved.id);
      setSavedCanvasSession((current) => current
        ? {
            ...current,
            id: saved.id,
            name: saved.name,
          }
        : current);
      setSavedDrawings((current) => {
        const next = current.filter((entry) => entry.id !== saved.id);
        return [saved, ...next];
      });
      setSaveFreeDrawModalOpen(false);
      setFreeDrawSaveNotice(`Saved ${saved.name}.`);
    } catch (error) {
      setCanvasSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setFreeDrawSaving(false);
    }
  }, [canvasNodes, canvasOffset.x, canvasOffset.y, canvasScale, canvasShapes, freeDrawSavedDrawingId, hiddenCanvasRelationshipIds, project.id, saveFreeDrawName]);
  const filteredObjects =
    selectedObjectTypeFilter === "all"
      ? customObjects
      : customObjects.filter((object) => object.objectTypeId === selectedObjectTypeFilter);
  const selectedObjectDetails = selectedObjectDetailsId
    ? filteredObjects.find((object) => object.id === selectedObjectDetailsId) ?? null
    : null;
  const selectedObjectDetailsType = selectedObjectDetails
    ? objectTypeById.get(selectedObjectDetails.objectTypeId) ?? null
    : null;
  const selectedObjectDetailsAttributeDefinitions = selectedObjectDetails
    ? objectAttributeDefinitions
        .filter((definition) => definition.objectTypeId === selectedObjectDetails.objectTypeId)
        .sort((left, right) => {
          if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
          return left.name.localeCompare(right.name);
        })
    : [];
  const selectedObjectRelationshipRows = selectedObjectDetails
    ? relationships
        .filter((relationship) => (
          relationship.fromObjectId === selectedObjectDetails.id
          || relationship.toObjectId === selectedObjectDetails.id
        ))
        .map((relationship) => {
          const otherObjectId = relationship.fromObjectId === selectedObjectDetails.id
            ? relationship.toObjectId
            : relationship.fromObjectId;
          const otherObject = objectById.get(otherObjectId) ?? null;
          const otherObjectTypeRecord = otherObject ? objectTypeById.get(otherObject.objectTypeId) ?? null : null;
          const relationshipTypeRecord = relationshipTypeById.get(relationship.relationshipTypeId) ?? null;
          const relationshipAppearance = getPostgresRelationshipAppearance(relationship, relationshipTypeRecord);
          return {
            id: relationship.id,
            otherObjectName: otherObject?.title || otherObjectId,
            otherObjectType: otherObject?.objectType || "Unknown",
            otherObjectShape: otherObject
              ? resolvePostgresObjectShape(otherObject, otherObjectTypeRecord)
              : "rounded",
            otherObjectFill: otherObject
              ? resolvePostgresObjectFill(otherObject, otherObjectTypeRecord)
              : "filled",
            otherObjectColor: otherObject
              ? resolvePostgresObjectColor(otherObject, otherObjectTypeRecord)
              : POSTGRES_OBJECT_TYPE_DEFAULT_COLOR,
            otherObjectSourceVisualKey: getPostgresSourceObjectVisualKey(otherObjectTypeRecord?.systemKey),
            otherObjectImageStoragePath: otherObject?.imageStoragePath || otherObjectTypeRecord?.imageStoragePath || "",
            relationshipName: relationship.relationshipType || relationshipTypeRecord?.name || "Relationship",
            relationshipLineShape: relationshipAppearance.lineShape,
            relationshipLineWeight: relationshipAppearance.lineWeight,
            relationshipArrowhead: relationshipAppearance.arrowhead,
            relationshipColor: relationshipAppearance.color,
          };
        })
        .sort((left, right) => (
          left.otherObjectName.localeCompare(right.otherObjectName, undefined, { sensitivity: "base" })
          || left.relationshipName.localeCompare(right.relationshipName, undefined, { sensitivity: "base" })
        ))
    : [];
  const objectAttributeDefinitionsForWorkspace = useMemo(
    () => objectAttributeDefinitions
      .filter((definition) => (
        selectedObjectTypeFilter === "all"
          ? customObjectTypeIds.has(definition.objectTypeId)
          : definition.objectTypeId === selectedObjectTypeFilter
      ))
      .sort((left, right) => {
        if (selectedObjectTypeFilter === "all") {
          const objectTypeComparison = left.objectType.localeCompare(right.objectType);
          if (objectTypeComparison !== 0) return objectTypeComparison;
        }
        if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
        return left.name.localeCompare(right.name);
      }),
    [customObjectTypeIds, objectAttributeDefinitions, selectedObjectTypeFilter],
  );
  const sortedObjectAttributeRows = useMemo(() => {
    const rows = filteredObjects.map((object) => ({
      id: object.id,
      name: object.title,
      valuesByDefinitionId: valuesForObject(object),
    }));
    return rows.sort((left, right) => {
      if (objectAttributeSortCol === "name") {
        const comparison = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
        return objectAttributeSortDir === "asc" ? comparison : -comparison;
      }
      const definition = objectAttributeDefinitionsForWorkspace.find((entry) => entry.id === objectAttributeSortCol);
      const leftValue = left.valuesByDefinitionId[objectAttributeSortCol] ?? "";
      const rightValue = right.valuesByDefinitionId[objectAttributeSortCol] ?? "";
      let comparison = 0;
      if (definition?.dataType === "number") {
        comparison = (Number(leftValue) || 0) - (Number(rightValue) || 0);
      } else {
        comparison = leftValue.localeCompare(rightValue, undefined, { sensitivity: "base" });
      }
      if (comparison === 0) {
        comparison = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
      }
      return objectAttributeSortDir === "asc" ? comparison : -comparison;
    });
  }, [
    filteredObjects,
    objectAttributeDefinitionsForWorkspace,
    objectAttributeSortCol,
    objectAttributeSortDir,
  ]);
  const relationshipTypeSummaries = relationshipTypes
    .map((relationshipType) => {
      const matchingRelationships = relationships.filter(
        (relationship) => relationship.relationshipTypeId === relationshipType.id,
      );
      const matchingDefinitions = relationshipAttributeDefinitions.filter(
        (definition) => definition.relationshipTypeId === relationshipType.id,
      );
      return {
        relationshipTypeId: relationshipType.id,
        relationshipType: relationshipType.name,
        constraint: formatRelationshipTypeConstraintSummary(relationshipType),
        count: matchingRelationships.length,
        attributeDefinitionCount: matchingDefinitions.length,
        lineShape: normalizePostgresRelationshipLineShape(relationshipType.lineShape),
        lineWeight: normalizePostgresRelationshipLineWeight(relationshipType.lineWeight),
        arrowhead: normalizePostgresRelationshipArrowhead(relationshipType.arrowhead),
        color: normalizePostgresRelationshipColor(relationshipType.color),
      };
    })
    .sort((left, right) => left.relationshipType.localeCompare(right.relationshipType));
  const relationshipWorkspaceAttributeTypeOptions = useMemo(
    () => relationshipTypeSummaries.map((summary) => ({
      id: summary.relationshipTypeId,
      label: summary.relationshipType,
      count: summary.count,
    })),
    [relationshipTypeSummaries],
  );
  const filteredRelationships =
    selectedRelationshipTypeFilter === "all"
      ? relationships
      : relationships.filter((relationship) => relationship.relationshipTypeId === selectedRelationshipTypeFilter);
  const selectedRelationshipDetails = selectedRelationshipDetailsId
    ? relationships.find((relationship) => relationship.id === selectedRelationshipDetailsId) ?? null
    : null;
  const selectedRelationshipDetailsType = selectedRelationshipDetails
    ? relationshipTypeById.get(selectedRelationshipDetails.relationshipTypeId) ?? null
    : null;
  const selectedRelationshipDetailsAppearance = selectedRelationshipDetails
    ? getPostgresRelationshipAppearance(selectedRelationshipDetails, selectedRelationshipDetailsType)
    : null;
  const selectedRelationshipDetailsAttributeDefinitions = selectedRelationshipDetails
    ? relationshipAttributeDefinitions
      .filter((definition) => definition.relationshipTypeId === selectedRelationshipDetails.relationshipTypeId)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name))
    : [];
  const relationshipAttributeDefinitionsForWorkspace = relationshipAttributeDefinitions
    .filter((definition) => (
      selectedRelationshipTypeFilter !== "all"
      && definition.relationshipTypeId === selectedRelationshipTypeFilter
    ))
    .sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
      return left.name.localeCompare(right.name);
    });
  const sortedRelationshipAttributeRows = useMemo(() => {
    const rows = filteredRelationships.map((relationship) => {
      const fromObject = objectById.get(relationship.fromObjectId);
      const toObject = objectById.get(relationship.toObjectId);
      return {
        id: relationship.id,
        name: `${relationship.relationshipType}: ${fromObject?.title ?? relationship.fromEntityName ?? relationship.fromObjectId} -> ${toObject?.title ?? relationship.toEntityName ?? relationship.toObjectId}`,
        valuesByDefinitionId: valuesForRelationship(relationship),
      };
    });
    return rows.sort((left, right) => {
      if (relationshipAttributeSortCol === "name") {
        const comparison = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
        return relationshipAttributeSortDir === "asc" ? comparison : -comparison;
      }
      const definition = relationshipAttributeDefinitionsForWorkspace.find((entry) => entry.id === relationshipAttributeSortCol);
      const leftValue = left.valuesByDefinitionId[relationshipAttributeSortCol] ?? "";
      const rightValue = right.valuesByDefinitionId[relationshipAttributeSortCol] ?? "";
      let comparison = 0;
      if (definition?.dataType === "number") {
        comparison = (Number(leftValue) || 0) - (Number(rightValue) || 0);
      } else {
        comparison = leftValue.localeCompare(rightValue, undefined, { sensitivity: "base" });
      }
      if (comparison === 0) {
        comparison = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
      }
      return relationshipAttributeSortDir === "asc" ? comparison : -comparison;
    });
  }, [
    filteredRelationships,
    objectById,
    relationshipAttributeDefinitionsForWorkspace,
    relationshipAttributeSortCol,
    relationshipAttributeSortDir,
  ]);
  const filteredRelationshipTypeSummaries = relationshipTypeSummaries.filter((summary) => {
    const query = relationshipTypeSearchTerm.trim().toLowerCase();
    if (!query) return true;
    return summary.relationshipType.toLowerCase().includes(query) || summary.constraint.toLowerCase().includes(query);
  });
  const filteredSavedDrawings = savedDrawings.filter((drawing) => drawing.canvasKind === selectedCanvasViewKind);
  useEffect(() => {
    if (selectedObjectTypeFilter === "all") return;
    if (customObjectTypeIds.has(selectedObjectTypeFilter)) return;
    setSelectedObjectTypeFilter("all");
  }, [customObjectTypeIds, selectedObjectTypeFilter]);

  useEffect(() => {
    if (!selectedObjectDetailsId) return;
    if (filteredObjects.some((object) => object.id === selectedObjectDetailsId)) return;
    setSelectedObjectDetailsId(null);
  }, [filteredObjects, selectedObjectDetailsId]);

  useEffect(() => {
    if (!selectedRelationshipDetailsId) return;
    if (relationships.some((relationship) => relationship.id === selectedRelationshipDetailsId)) return;
    setSelectedRelationshipDetailsId(null);
  }, [relationships, selectedRelationshipDetailsId]);

  useEffect(() => {
    if (objectAttributeSortCol === "name") return;
    if (objectAttributeDefinitionsForWorkspace.some((definition) => definition.id === objectAttributeSortCol)) return;
    setObjectAttributeSortCol("name");
    setObjectAttributeSortDir("asc");
  }, [objectAttributeDefinitionsForWorkspace, objectAttributeSortCol]);

  useEffect(() => {
    if (relationshipAttributeSortCol === "name") return;
    if (relationshipAttributeDefinitionsForWorkspace.some((definition) => definition.id === relationshipAttributeSortCol)) return;
    setRelationshipAttributeSortCol("name");
    setRelationshipAttributeSortDir("asc");
  }, [relationshipAttributeDefinitionsForWorkspace, relationshipAttributeSortCol]);

  function handleObjectAttributeSort(column: "name" | string) {
    if (objectAttributeSortCol === column) {
      setObjectAttributeSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setObjectAttributeSortCol(column);
    setObjectAttributeSortDir("asc");
  }

  function handleRelationshipAttributeSort(column: "name" | string) {
    if (relationshipAttributeSortCol === column) {
      setRelationshipAttributeSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setRelationshipAttributeSortCol(column);
    setRelationshipAttributeSortDir("asc");
  }

  function openObjectWorkspaceAttributeModal() {
    const defaultTypeIds = selectedObjectTypeFilter !== "all"
      ? [selectedObjectTypeFilter]
      : objectWorkspaceAttributeTypeOptions.map((option) => option.id);
    setObjectWorkspaceAttributeDraft({
      name: "",
      dataType: "text",
      description: "",
      options: [],
      typeIds: defaultTypeIds,
    });
    setObjectWorkspaceAttributeError("");
  }

  function openRelationshipWorkspaceAttributeModal() {
    const defaultTypeIds = selectedRelationshipTypeFilter !== "all"
      ? [selectedRelationshipTypeFilter]
      : relationshipWorkspaceAttributeTypeOptions.map((option) => option.id);
    setRelationshipWorkspaceAttributeDraft({
      name: "",
      dataType: "text",
      description: "",
      options: [],
      typeIds: defaultTypeIds,
    });
    setRelationshipWorkspaceAttributeError("");
  }

  function handleObjectTypeSort(column: PostgresObjectTypeSortCol) {
    if (objectTypeSortCol === column) {
      setObjectTypeSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setObjectTypeSortCol(column);
    setObjectTypeSortDir("asc");
  }
  const objectAttributeDefinitionsForCreateType = objectAttributeDefinitions.filter(
    (definition) => definition.objectTypeId === objectTypeId,
  );
  const objectAttributeDefinitionsForEditingType = objectAttributeDefinitions.filter(
    (definition) => definition.objectTypeId === editingObjectTypeId,
  );
  const relationshipAttributeDefinitionsForCreateType = relationshipAttributeDefinitions.filter(
    (definition) => definition.relationshipTypeId === relationshipTypeId,
  );
  const relationshipAttributeDefinitionsForEditingType = relationshipAttributeDefinitions.filter(
    (definition) => definition.relationshipTypeId === editingRelationshipTypeId,
  );
  const selectedRelationshipType = relationshipTypeById.get(relationshipTypeId) ?? null;
  const editingRelationshipTypeRecord = relationshipTypeById.get(editingRelationshipTypeId) ?? null;
  const availableFromEndpointOptions = useMemo<PostgresRelationshipEndpointOption[]>(() => {
    if (!selectedRelationshipType) return [];
    return [
      ...objects
        .filter((object) => postgresRelationshipTypeAllowsObjectEndpoint(selectedRelationshipType, "from", object.objectTypeId))
        .map((object) => ({
          key: `object:${object.id}`,
          entityType: "object" as const,
          entityId: object.id,
          name: object.title,
          type: object.objectType || "Object",
        })),
      ...sources
        .filter((source) => postgresRelationshipTypeAllowsSourceEndpoint(selectedRelationshipType, "from", source.sourceKind))
        .map((source) => ({
          key: `source:${source.id}`,
          entityType: "source" as const,
          entityId: source.id,
          name: source.title,
          type: POSTGRES_SOURCE_KIND_OPTIONS.find((option) => option.id === source.sourceKind)?.label ?? (source.sourceKind || "Source"),
        })),
    ].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  }, [objects, selectedRelationshipType, sources]);
  const availableToEndpointOptions = useMemo<PostgresRelationshipEndpointOption[]>(() => {
    if (!selectedRelationshipType) return [];
    return [
      ...objects
        .filter((object) => postgresRelationshipTypeAllowsObjectEndpoint(selectedRelationshipType, "to", object.objectTypeId))
        .map((object) => ({
          key: `object:${object.id}`,
          entityType: "object" as const,
          entityId: object.id,
          name: object.title,
          type: object.objectType || "Object",
        })),
      ...sources
        .filter((source) => postgresRelationshipTypeAllowsSourceEndpoint(selectedRelationshipType, "to", source.sourceKind))
        .map((source) => ({
          key: `source:${source.id}`,
          entityType: "source" as const,
          entityId: source.id,
          name: source.title,
          type: POSTGRES_SOURCE_KIND_OPTIONS.find((option) => option.id === source.sourceKind)?.label ?? (source.sourceKind || "Source"),
        })),
    ].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  }, [objects, selectedRelationshipType, sources]);
  const availableEditingFromObjects = editingRelationshipTypeRecord?.fromObjectTypeIds?.length
    ? objects.filter((object) => editingRelationshipTypeRecord.fromObjectTypeIds.includes(object.objectTypeId))
    : objects;
  const availableEditingToObjects = editingRelationshipTypeRecord?.toObjectTypeIds?.length
    ? objects.filter((object) => editingRelationshipTypeRecord.toObjectTypeIds.includes(object.objectTypeId))
    : objects;
  function openCreateObjectModal(prefilledTypeId?: string, preferredPosition?: PostgresCanvasPoint) {
    const nextTypeId = prefilledTypeId
      ?? (selectedObjectTypeFilter !== "all" ? selectedObjectTypeFilter : objectTypeId)
      ?? "";
    setObjectTypeId(nextTypeId || objectTypes[0]?.id || "");
    setObjectTitle("");
    setObjectDescription("");
    setObjectShapeOverride("");
    setObjectColorOverride("");
    setObjectFillOverride("");
    setObjectImageStoragePath("");
    setDraftObjectPendingImage(null);
    setObjectGraphicMode("inherit");
    setObjectAttributeValues({});
    setCreateObjectModalTab("details");
    setGraphError("");
    setPendingCanvasNodePosition(preferredPosition ?? null);
    setCreateObjectOpen(true);
  }

  function openEditObjectModal(object: PostgresObject, initialTab: "details" | "graphics" | "attributes" = "details") {
    setEditingObjectId(object.id);
    setEditObjectModalTab(initialTab);
    setEditingObjectTypeId(object.objectTypeId);
    setEditingObjectTitle(object.title);
    setEditingObjectDescription(object.description);
    setEditingObjectShapeOverride(object.shapeOverride ?? "");
    setEditingObjectColorOverride(object.colorOverride ?? "");
    setEditingObjectFillOverride(object.fillOverride ?? "");
    setEditingObjectImageStoragePath(object.imageStoragePath ?? "");
    setEditingObjectGraphicMode(
      object.imageStoragePath
        ? "upload"
        : object.shapeOverride || object.colorOverride || object.fillOverride
          ? "select"
          : "inherit",
    );
    setEditingObjectAttributeValues(valuesForObject(object));
  }

  function openObjectTypeModalForEdit(objectTypeId: string, tab: "details" | "attributes") {
    const objectTypeRecord = objectTypeById.get(objectTypeId);
    if (!objectTypeRecord) return;
    setEditingObjectTypeModalId(objectTypeId);
    setDraftObjectTypeName(objectTypeRecord.name);
    setDraftObjectTypeDescription(objectTypeRecord.description);
    setDraftObjectTypeShape(
      normalizePostgresObjectTypeShape(objectTypeRecord.shape),
    );
    setDraftObjectTypeColor(
      normalizePostgresObjectTypeColor(objectTypeRecord.color),
    );
    setDraftObjectTypeFill(
      normalizePostgresObjectFill(objectTypeRecord.fill),
    );
    setDraftObjectTypeImageStoragePath(objectTypeRecord.imageStoragePath ?? "");
    setDraftObjectTypePendingImage(null);
    setDraftObjectTypeGraphicMode(objectTypeRecord.imageStoragePath ? "upload" : "select");
    initializeObjectTypeAttributeEditor(objectTypeId);
    setObjectTypeModalTab(tab);
    setGraphError("");
    setGraphNotice("");
    setCreateObjectTypeOpen(false);
  }

  function openEditRelationshipModal(relationship: PostgresRelationship, initialTab: "details" | "graphics" | "attributes" = "details") {
    setEditRelationshipModalTab(initialTab);
    setEditingRelationshipId(relationship.id);
    setEditingRelationshipFromObjectId(relationship.fromObjectId);
    setEditingRelationshipToObjectId(relationship.toObjectId);
    setEditingRelationshipTypeId(relationship.relationshipTypeId);
    setEditingRelationshipDescription(relationship.description);
    setEditingRelationshipLineShapeOverride(relationship.lineShapeOverride ?? "");
    setEditingRelationshipLineWeightOverride(relationship.lineWeightOverride ?? null);
    setEditingRelationshipArrowheadOverride(relationship.arrowheadOverride ?? "");
    setEditingRelationshipColorOverride(relationship.colorOverride ?? "");
    setEditingRelationshipAttributeValues(valuesForRelationship(relationship));
  }

  function openCreateRelationshipModal() {
    setCreateRelationshipModalTab("details");
    setFromObjectId("");
    setToObjectId("");
    setRelationshipDescription("");
    setRelationshipLineShapeOverride("");
    setRelationshipLineWeightOverride(null);
    setRelationshipArrowheadOverride("");
    setRelationshipColorOverride("");
    setRelationshipAttributeValues({});
    setGraphError("");
    setCreateRelationshipOpen(true);
  }

  function openCreateRelationshipTypeModal() {
    setDraftRelationshipTypeName("");
    setDraftRelationshipLineShape("solid");
    setDraftRelationshipLineWeight(2);
    setDraftRelationshipArrowhead("one_sided");
    setDraftRelationshipColor(POSTGRES_RELATIONSHIP_DEFAULT_COLOR);
    setDraftRelationshipFromObjectTypeIds(allObjectTypeIds);
    setDraftRelationshipToObjectTypeIds(allObjectTypeIds);
    setDraftRelationshipFromSourceKinds(allSourceKindIds);
    setDraftRelationshipToSourceKinds(allSourceKindIds);
    setRelationshipTypeModalTab("details");
    initializeRelationshipTypeAttributeEditor(null);
    setEditingRelationshipTypeModalId(null);
    setGraphError("");
    setCreateRelationshipTypeOpen(true);
  }

  function closeCreateRelationshipModal() {
    setCreateRelationshipOpen(false);
  }

  function closeCreateObjectModal() {
    setPendingCanvasNodePosition(null);
    setDraftObjectPendingImage(null);
    setObjectImageStoragePath("");
    setCreateObjectOpen(false);
  }

  function initializeObjectTypeAttributeEditor(objectTypeId: string | null) {
    setObjectTypeAttributeDrafts(
      objectTypeId
        ? objectAttributeDefinitions
          .filter((definition) => definition.objectTypeId === objectTypeId)
          .map((definition) =>
            createTypeAttributeDraft({
              id: definition.id,
              name: definition.name,
              dataType: definition.dataType,
              description: definition.description,
              options: definition.options,
            }))
        : [],
    );
    setObjectTypeAttributeModalDraft(null);
    setTypeAttributeModalError("");
  }

  function initializeRelationshipTypeAttributeEditor(relationshipTypeId: string | null) {
    setRelationshipTypeAttributeDrafts(
      relationshipTypeId
        ? relationshipAttributeDefinitions
          .filter((definition) => definition.relationshipTypeId === relationshipTypeId)
          .map((definition) =>
            createTypeAttributeDraft({
              id: definition.id,
              name: definition.name,
              dataType: definition.dataType,
              description: definition.description,
              options: definition.options,
            }))
        : [],
    );
    setRelationshipTypeAttributeModalDraft(null);
    setTypeAttributeModalError("");
  }

  function renderRelationshipTypeModal(config: {
    title: string;
    hint?: string;
    submitLabel: string;
    ariaLabel: string;
    onClose: () => void;
    onSubmit: (event: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
  }) {
    return (
      <div className="modal-overlay" style={{ zIndex: 120 }} onClick={() => !graphSubmitting && config.onClose()}>
        <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
          <h2>{config.title}</h2>
          {config.hint ? (
            <p className="auth-hint" style={{ marginTop: 0 }}>
              {config.hint}
            </p>
          ) : null}
          <form onSubmit={config.onSubmit} className="form">
            <div className="auth-tabs" role="tablist" aria-label={config.ariaLabel}>
              <button
                type="button"
                className={`auth-tab ${relationshipTypeModalTab === "details" ? "auth-tab--active" : ""}`}
                onClick={() => setRelationshipTypeModalTab("details")}
              >
                Details
              </button>
              <button
                type="button"
                className={`auth-tab ${relationshipTypeModalTab === "object1" ? "auth-tab--active" : ""}`}
                onClick={() => setRelationshipTypeModalTab("object1")}
              >
                Object 1
              </button>
              <button
                type="button"
                className={`auth-tab ${relationshipTypeModalTab === "object2" ? "auth-tab--active" : ""}`}
                onClick={() => setRelationshipTypeModalTab("object2")}
              >
                Object 2
              </button>
              <button
                type="button"
                className={`auth-tab ${relationshipTypeModalTab === "attributes" ? "auth-tab--active" : ""}`}
                onClick={() => setRelationshipTypeModalTab("attributes")}
              >
                Attributes
              </button>
            </div>
            {relationshipTypeModalTab === "details" ? (
              <>
                <label className="form-label">
                  Relationship type name
                  <input
                    className="form-input"
                    value={draftRelationshipTypeName}
                    onChange={(event) => setDraftRelationshipTypeName(event.target.value)}
                    autoFocus
                  />
                </label>
                <label className="form-label">
                  Color
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <input
                      className="form-input form-input--color"
                      type="color"
                      value={draftRelationshipColor}
                      onChange={(event) => setDraftRelationshipColor(event.target.value)}
                    />
                    <input
                      className="form-input"
                      value={draftRelationshipColor}
                      onChange={(event) => setDraftRelationshipColor(event.target.value)}
                    />
                  </div>
                </label>
                <label className="form-label">
                  Line shape
                  <PostgresRelationshipLineShapePicker
                    value={draftRelationshipLineShape}
                    onChange={(value) => setDraftRelationshipLineShape((value || "solid") as PostgresRelationshipLineShape)}
                    previewColor={draftRelationshipColor}
                  />
                </label>
                <label className="form-label">
                  Line weight
                  <PostgresRelationshipLineWeightPicker
                    value={draftRelationshipLineWeight}
                    onChange={(value) => setDraftRelationshipLineWeight(value ?? 2)}
                    previewColor={draftRelationshipColor}
                  />
                </label>
                <label className="form-label">
                  Arrowheads
                  <PostgresRelationshipArrowheadPicker
                    value={draftRelationshipArrowhead}
                    onChange={(value) => setDraftRelationshipArrowhead((value || "one_sided") as PostgresRelationshipArrowhead)}
                    previewColor={draftRelationshipColor}
                  />
                </label>
              </>
            ) : relationshipTypeModalTab === "object1" ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                  gap: 16,
                }}
              >
                <PostgresRelationshipEndpointRestrictionColumn
                  title="Objects"
                  items={objectTypes.map((objectType) => ({
                    id: objectType.id,
                    label: objectType.name,
                    color: normalizePostgresObjectTypeColor(objectType.color),
                    shape: normalizePostgresObjectTypeShape(objectType.shape),
                    fill: normalizePostgresObjectFill(objectType.fill),
                    imageStoragePath: objectType.imageStoragePath ?? "",
                  }))}
                  value={draftRelationshipFromObjectTypeIds}
                  onChange={setDraftRelationshipFromObjectTypeIds}
                  projectStoragePath={project.storagePath}
                />
                <PostgresRelationshipEndpointRestrictionColumn
                  title="Sources"
                  items={POSTGRES_SOURCE_KIND_OPTIONS}
                  value={draftRelationshipFromSourceKinds}
                  onChange={setDraftRelationshipFromSourceKinds}
                  projectStoragePath={project.storagePath}
                />
              </div>
            ) : relationshipTypeModalTab === "object2" ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                  gap: 16,
                }}
              >
                <PostgresRelationshipEndpointRestrictionColumn
                  title="Objects"
                  items={objectTypes.map((objectType) => ({
                    id: objectType.id,
                    label: objectType.name,
                    color: normalizePostgresObjectTypeColor(objectType.color),
                    shape: normalizePostgresObjectTypeShape(objectType.shape),
                    fill: normalizePostgresObjectFill(objectType.fill),
                    imageStoragePath: objectType.imageStoragePath ?? "",
                  }))}
                  value={draftRelationshipToObjectTypeIds}
                  onChange={setDraftRelationshipToObjectTypeIds}
                  projectStoragePath={project.storagePath}
                />
                <PostgresRelationshipEndpointRestrictionColumn
                  title="Sources"
                  items={POSTGRES_SOURCE_KIND_OPTIONS}
                  value={draftRelationshipToSourceKinds}
                  onChange={setDraftRelationshipToSourceKinds}
                  projectStoragePath={project.storagePath}
                />
              </div>
            ) : (
              <>
                <div className="postgres-attribute-modal-section">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      marginBottom: 12,
                    }}
                  >
                    <div className="postgres-attribute-modal-title">Attributes</div>
                    <button type="button" className="btn btn--small" onClick={openNewRelationshipTypeAttributeModal}>
                      Add attribute
                    </button>
                  </div>
                  {relationshipTypeAttributeDrafts.length === 0 ? (
                    <p className="auth-hint" style={{ margin: 0 }}>No attributes for this relationship type yet.</p>
                  ) : (
                    <div className="postgres-attribute-multiselect">
                      {relationshipTypeAttributeDrafts.map((draft) => (
                        <div key={draft.localId} className="postgres-attribute-option">
                          <span className="postgres-attribute-option-body">
                            <strong>{draft.name}</strong>
                            <span>{draft.dataType}</span>
                            <span>{draft.description || (draft.options.length > 0 ? draft.options.join(", ") : "No description")}</span>
                          </span>
                          <div className="project-card-actions">
                            <button type="button" className="btn btn--ghost" onClick={() => openEditRelationshipTypeAttributeModal(draft)}>
                              Edit
                            </button>
                            <button type="button" className="btn btn--ghost-danger" onClick={() => deleteRelationshipTypeAttributeDraft(draft.localId)}>
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <p className="auth-hint" style={{ marginTop: 16, marginBottom: 0 }}>
                  Attribute changes will be saved when you save the relationship type.
                </p>
              </>
            )}
            <div className="form-actions">
              <button type="button" className="btn" onClick={config.onClose} disabled={graphSubmitting}>
                Cancel
              </button>
              <button type="submit" className="btn btn--primary" disabled={graphSubmitting}>
                {graphSubmitting ? "Saving..." : config.submitLabel}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  function renderObjectModal(config: {
    title: string;
    ariaLabel: string;
    tab: "details" | "graphics" | "attributes";
    setTab: Dispatch<SetStateAction<"details" | "graphics" | "attributes">>;
    submitLabel: string;
    objectTypeId: string;
    titleValue: string;
    descriptionValue: string;
    colorOverride: string;
    shapeOverride: string;
    fillOverride: string;
    imageStoragePath: string;
    imagePreviewUrl?: string;
    graphicMode: PostgresObjectInstanceGraphicMode;
    selectedType: PostgresObjectType | null;
    attributeDefinitions: PostgresObjectAttributeDefinition[];
    attributeValues: Record<string, string>;
    onClose: () => void;
    onSubmit: (event: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
    setObjectTypeId: Dispatch<SetStateAction<string>>;
    setTitleValue: Dispatch<SetStateAction<string>>;
    setDescriptionValue: Dispatch<SetStateAction<string>>;
    setColorOverride: Dispatch<SetStateAction<string>>;
    setShapeOverride: Dispatch<SetStateAction<string>>;
    setFillOverride: Dispatch<SetStateAction<string>>;
    setImageStoragePath: Dispatch<SetStateAction<string>>;
    setGraphicMode: Dispatch<SetStateAction<PostgresObjectInstanceGraphicMode>>;
    setAttributeValues: Dispatch<SetStateAction<Record<string, string>>>;
    onImportImage?: () => void;
    onRemoveImage?: () => void;
    onClearPendingImage?: () => void;
  }) {
    const inheritedColor = normalizePostgresObjectTypeColor(config.selectedType?.color || "");
    const effectiveColor = resolvePostgresObjectColor({ colorOverride: config.colorOverride }, config.selectedType);
    const colorInherited = !config.colorOverride.trim();
    const inheritedShape = resolvePostgresObjectShape({ shapeOverride: "" }, config.selectedType);
    const effectiveShape = resolvePostgresObjectShape({ shapeOverride: config.shapeOverride }, config.selectedType);
    const inheritedFill = resolvePostgresObjectFill({ fillOverride: "" }, config.selectedType);
    const effectiveFill = resolvePostgresObjectFill({ fillOverride: config.fillOverride }, config.selectedType);
    const effectiveImageStoragePath = config.imageStoragePath || config.selectedType?.imageStoragePath || "";

    return (
      <div className="modal-overlay" onClick={() => !graphSubmitting && config.onClose()}>
        <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
          <h2>{config.title}</h2>
          <form onSubmit={config.onSubmit} className="form">
            <div className="auth-tabs" role="tablist" aria-label={config.ariaLabel}>
              <button
                type="button"
                className={`auth-tab ${config.tab === "details" ? "auth-tab--active" : ""}`}
                onClick={() => config.setTab("details")}
              >
                Details
              </button>
              <button
                type="button"
                className={`auth-tab ${config.tab === "graphics" ? "auth-tab--active" : ""}`}
                onClick={() => config.setTab("graphics")}
              >
                Graphics
              </button>
              <button
                type="button"
                className={`auth-tab ${config.tab === "attributes" ? "auth-tab--active" : ""}`}
                onClick={() => config.setTab("attributes")}
              >
                Attributes
              </button>
            </div>
            {config.tab === "details" ? (
              <>
                <label className="form-label">
                  Object type
                  <select className="form-input" value={config.objectTypeId} onChange={(event) => config.setObjectTypeId(event.target.value)} autoFocus>
                    <option value="" disabled>Select an object type</option>
                    {objectTypes.map((objectType) => (
                      <option key={objectType.id} value={objectType.id}>{objectType.name}</option>
                    ))}
                  </select>
                </label>
                <label className="form-label">
                  Title
                  <input className="form-input" value={config.titleValue} onChange={(event) => config.setTitleValue(event.target.value)} />
                </label>
                <label className="form-label">
                  Description
                  <textarea className="form-input form-textarea" rows={3} value={config.descriptionValue} onChange={(event) => config.setDescriptionValue(event.target.value)} />
                </label>
              </>
            ) : config.tab === "graphics" ? (
              <>
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <div className="auth-tabs" role="tablist" aria-label="Object graphic source" style={{ width: 330, marginBottom: 0 }}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={config.graphicMode === "inherit"}
                      className={`auth-tab ${config.graphicMode === "inherit" ? "auth-tab--active" : ""}`}
                      onClick={() =>
                        handleSetObjectGraphicMode("inherit", {
                          setMode: config.setGraphicMode,
                          setShapeOverride: config.setShapeOverride,
                          setColorOverride: config.setColorOverride,
                          setFillOverride: config.setFillOverride,
                          setImageStoragePath: config.setImageStoragePath,
                          onClearPendingImage: config.onClearPendingImage,
                          objectId: editingObjectId,
                        })
                      }
                      disabled={graphSubmitting || imageUploadSubmitting}
                    >
                      Inherit
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={config.graphicMode === "select"}
                      className={`auth-tab ${config.graphicMode === "select" ? "auth-tab--active" : ""}`}
                      onClick={() =>
                        handleSetObjectGraphicMode("select", {
                          setMode: config.setGraphicMode,
                          setShapeOverride: config.setShapeOverride,
                          setColorOverride: config.setColorOverride,
                          setFillOverride: config.setFillOverride,
                          setImageStoragePath: config.setImageStoragePath,
                          onClearPendingImage: config.onClearPendingImage,
                          objectId: editingObjectId,
                        })
                      }
                      disabled={graphSubmitting || imageUploadSubmitting}
                    >
                      Select
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={config.graphicMode === "upload"}
                      className={`auth-tab ${config.graphicMode === "upload" ? "auth-tab--active" : ""}`}
                      onClick={() =>
                        handleSetObjectGraphicMode("upload", {
                          setMode: config.setGraphicMode,
                          setShapeOverride: config.setShapeOverride,
                          setColorOverride: config.setColorOverride,
                          setFillOverride: config.setFillOverride,
                          setImageStoragePath: config.setImageStoragePath,
                          objectId: editingObjectId,
                        })
                      }
                      disabled={graphSubmitting || imageUploadSubmitting}
                    >
                      Upload
                    </button>
                  </div>
                </div>
                {config.graphicMode === "inherit" ? (
                  <p className="auth-hint" style={{ margin: "4px 0 0", textAlign: "center" }}>
                    This object will inherit its graphical elements from its object type.
                  </p>
                ) : config.graphicMode === "upload" ? (
                  <label className="form-label">
                    Image
                    <PostgresObjectImageControls
                      projectStoragePath={project.storagePath}
                      imageStoragePath={effectiveImageStoragePath}
                      previewUrl={config.imagePreviewUrl ?? ""}
                      canUpload={!!config.onImportImage}
                      disabled={graphSubmitting || imageUploadSubmitting}
                      onUpload={config.onImportImage}
                      onRemove={config.imageStoragePath || config.imagePreviewUrl ? config.onRemoveImage : undefined}
                      fallback={(
                        <ObjectShapeSwatch
                          shape={effectiveShape}
                          fill={effectiveFill}
                          color={effectiveColor}
                          sourceVisualKey={getPostgresSourceObjectVisualKey(config.selectedType?.systemKey)}
                          width={56}
                          minHeight={44}
                        />
                      )}
                    />
                  </label>
                ) : (
                  <>
                    <label className="form-label">
                      Color
                      <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
                        <input
                          className="form-input form-input--color"
                          type="color"
                          value={effectiveColor}
                          onChange={(event) => config.setColorOverride(event.target.value)}
                          style={{ width: 92, minWidth: 92, height: 56 }}
                        />
                        <input
                          className="form-input"
                          value={colorInherited ? inheritedColor : config.colorOverride}
                          onChange={(event) => config.setColorOverride(event.target.value)}
                          style={{ flex: "0 0 148px", fontFamily: "monospace" }}
                        />
                      </div>
                    </label>
                    <label className="form-label">
                      Shape
                      <PostgresObjectShapePicker
                        value={effectiveShape}
                        onChange={(value) => config.setShapeOverride(value === inheritedShape ? "" : value)}
                        previewColor={effectiveColor}
                        previewFill={effectiveFill}
                      />
                    </label>
                    <label className="form-label">
                      Fill
                      <PostgresObjectFillPicker
                        value={effectiveFill}
                        onChange={(value) => config.setFillOverride(value === inheritedFill ? "" : value)}
                        previewColor={effectiveColor}
                        previewShape={effectiveShape}
                      />
                    </label>
                  </>
                )}
              </>
            ) : config.attributeDefinitions.length > 0 ? (
              <div className="case-detail-attributes-table-wrap">
                <table className="case-detail-attributes-table">
                  <tbody>
                    {config.attributeDefinitions.map((definition) => (
                      <tr key={definition.id}>
                        <th className="case-detail-attributes-label" scope="row">{definition.name}</th>
                        <td className="case-detail-attributes-value">
                          {definition.dataType === "categorical" ? (
                            <select
                              className="form-input"
                              value={config.attributeValues[definition.id] ?? ""}
                              onChange={(event) =>
                                config.setAttributeValues((current) => ({ ...current, [definition.id]: event.target.value }))
                              }
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
                              value={config.attributeValues[definition.id] ?? ""}
                              onChange={(event) =>
                                config.setAttributeValues((current) => ({ ...current, [definition.id]: event.target.value }))
                              }
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="auth-hint" style={{ marginTop: 0 }}>
                No shared attributes for this relationship type yet.
              </p>
            )}
            <div className="form-actions">
              <button type="button" className="btn" onClick={config.onClose} disabled={graphSubmitting}>
                Cancel
              </button>
              <button type="submit" className="btn btn--primary" disabled={graphSubmitting}>
                {graphSubmitting ? "Saving..." : config.submitLabel}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  function renderOverrideFieldHeader(
    label: string,
    options: {
      inherited: boolean;
      inheritedFrom: string;
      onReset: () => void;
    },
  ) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span>{label}</span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "3px 8px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: options.inherited ? "#52606d" : "#355070",
              background: options.inherited ? "rgba(82, 96, 109, 0.12)" : "rgba(53, 80, 112, 0.12)",
            }}
          >
            {options.inherited ? "Inherited" : "Custom"}
          </span>
          {options.inherited ? (
            <span className="auth-hint" style={{ margin: 0 }}>
              {`From ${options.inheritedFrom}`}
            </span>
          ) : null}
        </div>
        {!options.inherited ? (
          <button type="button" className="btn btn--ghost" onClick={options.onReset}>
            Reset to inherited
          </button>
        ) : null}
      </div>
    );
  }

  function renderRelationshipModal(config: {
    title: string;
    ariaLabel: string;
    tab: "details" | "graphics" | "attributes";
    setTab: Dispatch<SetStateAction<"details" | "graphics" | "attributes">>;
    submitLabel: string;
    fromObjectId: string;
    toObjectId: string;
    relationshipTypeId: string;
    description: string;
    lineShapeOverride: string;
    lineWeightOverride: number | null;
    arrowheadOverride: string;
    colorOverride: string;
    availableFromObjects: PostgresObject[];
    availableToObjects: PostgresObject[];
    availableFromEndpointOptions?: PostgresRelationshipEndpointOption[];
    availableToEndpointOptions?: PostgresRelationshipEndpointOption[];
    selectedType: PostgresRelationshipType | null;
    attributeDefinitions: PostgresRelationshipAttributeDefinition[];
    attributeValues: Record<string, string>;
    onClose: () => void;
    onSubmit: (event: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
    setFromObjectId: Dispatch<SetStateAction<string>>;
    setToObjectId: Dispatch<SetStateAction<string>>;
    setRelationshipTypeId: Dispatch<SetStateAction<string>>;
    setDescription: Dispatch<SetStateAction<string>>;
    setLineShapeOverride: Dispatch<SetStateAction<string>>;
    setLineWeightOverride: Dispatch<SetStateAction<number | null>>;
    setArrowheadOverride: Dispatch<SetStateAction<string>>;
    setColorOverride: Dispatch<SetStateAction<string>>;
    setAttributeValues: Dispatch<SetStateAction<Record<string, string>>>;
    onNewRelationshipType?: () => void;
  }) {
    const inheritedRelationshipColor = normalizePostgresRelationshipColor(config.selectedType?.color || "");
    const relationshipColorIsInherited = !config.colorOverride.trim();
    const effectiveRelationshipColor = resolvePostgresRelationshipColor({ colorOverride: config.colorOverride }, config.selectedType);
    const inheritedRelationshipLineShape = resolvePostgresRelationshipLineShape({ lineShapeOverride: "" }, config.selectedType);
    const relationshipLineShapeIsInherited = !config.lineShapeOverride.trim();
    const effectiveRelationshipLineShape = resolvePostgresRelationshipLineShape({ lineShapeOverride: config.lineShapeOverride }, config.selectedType);
    const inheritedRelationshipLineWeight = resolvePostgresRelationshipLineWeight({ lineWeightOverride: null }, config.selectedType);
    const relationshipLineWeightIsInherited = config.lineWeightOverride == null;
    const effectiveRelationshipLineWeight = resolvePostgresRelationshipLineWeight({ lineWeightOverride: config.lineWeightOverride }, config.selectedType);
    const inheritedRelationshipArrowhead = resolvePostgresRelationshipArrowhead({ arrowheadOverride: "" }, config.selectedType);
    const relationshipArrowheadIsInherited = !config.arrowheadOverride.trim();
    const effectiveRelationshipArrowhead = resolvePostgresRelationshipArrowhead({ arrowheadOverride: config.arrowheadOverride }, config.selectedType);

    return (
      <div className="modal-overlay" onClick={() => !graphSubmitting && config.onClose()}>
        <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
          <h2>{config.title}</h2>
          <form onSubmit={config.onSubmit} className="form">
            <div className="auth-tabs" role="tablist" aria-label={config.ariaLabel}>
              <button
                type="button"
                className={`auth-tab ${config.tab === "details" ? "auth-tab--active" : ""}`}
                onClick={() => config.setTab("details")}
              >
                Details
              </button>
              <button
                type="button"
                className={`auth-tab ${config.tab === "graphics" ? "auth-tab--active" : ""}`}
                onClick={() => config.setTab("graphics")}
              >
                Graphics
              </button>
              <button
                type="button"
                className={`auth-tab ${config.tab === "attributes" ? "auth-tab--active" : ""}`}
                onClick={() => config.setTab("attributes")}
              >
                Attributes
              </button>
            </div>
            {config.tab === "details" ? (
              <>
                <label className="form-label">
                  Relationship type
                  <select
                    className="form-input"
                    value={config.relationshipTypeId}
                    onChange={(event) => {
                      if (event.target.value === "__new_relationship_type__") {
                        config.onNewRelationshipType?.();
                        return;
                      }
                      config.setRelationshipTypeId(event.target.value);
                    }}
                    autoFocus
                  >
                    <option value="">Select relationship type</option>
                    {relationshipTypes.map((relationshipType) => (
                      <option key={relationshipType.id} value={relationshipType.id}>{relationshipType.name}</option>
                    ))}
                    <option value="__new_relationship_type__">Add new relationship type...</option>
                  </select>
                </label>
                {config.selectedType ? (
                  <p className="auth-hint" style={{ marginTop: 0 }}>
                    {`This relationship type rule is: ${formatRelationshipTypeConstraintSummary(config.selectedType)}.`}
                  </p>
                ) : null}
                {config.availableFromEndpointOptions && config.availableToEndpointOptions ? (
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
                    <PostgresRelationshipEndpointSingleSelect
                      label="From"
                      options={config.availableFromEndpointOptions}
                      value={config.fromObjectId}
                      onChange={config.setFromObjectId}
                    />
                    <PostgresRelationshipEndpointSingleSelect
                      label="To"
                      options={config.availableToEndpointOptions}
                      value={config.toObjectId}
                      onChange={config.setToObjectId}
                    />
                  </div>
                ) : (
                  <>
                    <label className="form-label">
                      From object
                      <select className="form-input" value={config.fromObjectId} onChange={(event) => config.setFromObjectId(event.target.value)}>
                        <option value="">Select object</option>
                        {config.availableFromObjects.map((object) => (
                          <option key={object.id} value={object.id}>{object.title}</option>
                        ))}
                      </select>
                    </label>
                    <label className="form-label">
                      To object
                      <select className="form-input" value={config.toObjectId} onChange={(event) => config.setToObjectId(event.target.value)}>
                        <option value="">Select object</option>
                        {config.availableToObjects.map((object) => (
                          <option key={object.id} value={object.id}>{object.title}</option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                <label className="form-label">
                  Description
                  <textarea className="form-input form-textarea" rows={3} value={config.description} onChange={(event) => config.setDescription(event.target.value)} />
                </label>
              </>
            ) : config.tab === "graphics" ? (
              <>
                <label className="form-label">
                  {renderOverrideFieldHeader("Color", {
                    inherited: relationshipColorIsInherited,
                    inheritedFrom: "relationship type",
                    onReset: () => config.setColorOverride(""),
                  })}
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <input
                      className="form-input form-input--color"
                      type="color"
                      value={effectiveRelationshipColor}
                      onChange={(event) => config.setColorOverride(event.target.value)}
                    />
                    <input
                      className="form-input"
                      value={relationshipColorIsInherited ? inheritedRelationshipColor : config.colorOverride}
                      onChange={(event) => config.setColorOverride(event.target.value)}
                      style={{ flex: "0 0 148px", fontFamily: "monospace" }}
                    />
                  </div>
                </label>
                <label className="form-label">
                  {renderOverrideFieldHeader("Line shape", {
                    inherited: relationshipLineShapeIsInherited,
                    inheritedFrom: "relationship type",
                    onReset: () => config.setLineShapeOverride(""),
                  })}
                  <PostgresRelationshipLineShapePicker
                    value={effectiveRelationshipLineShape}
                    onChange={(value) =>
                      config.setLineShapeOverride(value === inheritedRelationshipLineShape ? "" : value)
                    }
                    previewColor={effectiveRelationshipColor}
                  />
                </label>
                <label className="form-label">
                  {renderOverrideFieldHeader("Line weight", {
                    inherited: relationshipLineWeightIsInherited,
                    inheritedFrom: "relationship type",
                    onReset: () => config.setLineWeightOverride(null),
                  })}
                  <PostgresRelationshipLineWeightPicker
                    value={effectiveRelationshipLineWeight}
                    onChange={(value) =>
                      config.setLineWeightOverride(value === inheritedRelationshipLineWeight ? null : value)
                    }
                    previewColor={effectiveRelationshipColor}
                  />
                </label>
                <label className="form-label">
                  {renderOverrideFieldHeader("Arrowheads", {
                    inherited: relationshipArrowheadIsInherited,
                    inheritedFrom: "relationship type",
                    onReset: () => config.setArrowheadOverride(""),
                  })}
                  <PostgresRelationshipArrowheadPicker
                    value={effectiveRelationshipArrowhead}
                    onChange={(value) =>
                      config.setArrowheadOverride(value === inheritedRelationshipArrowhead ? "" : value)
                    }
                    previewColor={effectiveRelationshipColor}
                  />
                </label>
              </>
            ) : config.attributeDefinitions.length > 0 ? (
              <div className="case-detail-attributes-table-wrap">
                <table className="case-detail-attributes-table">
                  <tbody>
                    {config.attributeDefinitions.map((definition) => (
                      <tr key={definition.id}>
                        <th className="case-detail-attributes-label" scope="row">{definition.name}</th>
                        <td className="case-detail-attributes-value">
                          {definition.dataType === "categorical" ? (
                            <select
                              className="form-input"
                              value={config.attributeValues[definition.id] ?? ""}
                              onChange={(event) =>
                                config.setAttributeValues((current) => ({ ...current, [definition.id]: event.target.value }))
                              }
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
                              value={config.attributeValues[definition.id] ?? ""}
                              onChange={(event) =>
                                config.setAttributeValues((current) => ({ ...current, [definition.id]: event.target.value }))
                              }
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="auth-hint" style={{ marginTop: 0 }}>
                No shared attributes for this relationship type yet.
              </p>
            )}
            <div className="form-actions">
              <button type="button" className="btn" onClick={config.onClose} disabled={graphSubmitting}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={graphSubmitting || (
                  config.availableFromEndpointOptions && config.availableToEndpointOptions
                    ? !config.fromObjectId || !config.toObjectId
                    : objects.length < 2
                )}
              >
                {graphSubmitting ? "Saving..." : config.submitLabel}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  function openNewObjectTypeAttributeModal() {
    setTypeAttributeModalError("");
    setObjectTypeAttributeModalDraft(createTypeAttributeDraft());
  }

  function openEditObjectTypeAttributeModal(draft: TypeAttributeDraft) {
    setTypeAttributeModalError("");
    setObjectTypeAttributeModalDraft({ ...draft, options: [...draft.options] });
  }

  function saveObjectTypeAttributeDraft(draft: SharedAttributeDraft) {
    const duplicateExists = objectTypeAttributeDrafts.some(
      (entry) =>
        entry.localId !== objectTypeAttributeModalDraft?.localId
        && entry.name.trim().toLowerCase() === draft.name.trim().toLowerCase(),
    );
    if (duplicateExists) {
      setTypeAttributeModalError(`An attribute named "${draft.name}" already exists in this object type.`);
      return;
    }
    setObjectTypeAttributeDrafts((current) => {
      if (objectTypeAttributeModalDraft && current.some((entry) => entry.localId === objectTypeAttributeModalDraft.localId)) {
        return current.map((entry) =>
          entry.localId === objectTypeAttributeModalDraft.localId ? { ...entry, ...draft } : entry,
        );
      }
      return [...current, createTypeAttributeDraft(draft)];
    });
    setObjectTypeAttributeModalDraft(null);
    setTypeAttributeModalError("");
  }

  function deleteObjectTypeAttributeDraft(localId: string) {
    setObjectTypeAttributeDrafts((current) => current.filter((entry) => entry.localId !== localId));
  }

  function openNewRelationshipTypeAttributeModal() {
    setTypeAttributeModalError("");
    setRelationshipTypeAttributeModalDraft(createTypeAttributeDraft());
  }

  function openEditRelationshipTypeAttributeModal(draft: TypeAttributeDraft) {
    setTypeAttributeModalError("");
    setRelationshipTypeAttributeModalDraft({ ...draft, options: [...draft.options] });
  }

  function saveRelationshipTypeAttributeDraft(draft: SharedAttributeDraft) {
    const duplicateExists = relationshipTypeAttributeDrafts.some(
      (entry) =>
        entry.localId !== relationshipTypeAttributeModalDraft?.localId
        && entry.name.trim().toLowerCase() === draft.name.trim().toLowerCase(),
    );
    if (duplicateExists) {
      setTypeAttributeModalError(`An attribute named "${draft.name}" already exists in this relationship type.`);
      return;
    }
    setRelationshipTypeAttributeDrafts((current) => {
      if (relationshipTypeAttributeModalDraft && current.some((entry) => entry.localId === relationshipTypeAttributeModalDraft.localId)) {
        return current.map((entry) =>
          entry.localId === relationshipTypeAttributeModalDraft.localId ? { ...entry, ...draft } : entry,
        );
      }
      return [...current, createTypeAttributeDraft(draft)];
    });
    setRelationshipTypeAttributeModalDraft(null);
    setTypeAttributeModalError("");
  }

  function deleteRelationshipTypeAttributeDraft(localId: string) {
    setRelationshipTypeAttributeDrafts((current) => current.filter((entry) => entry.localId !== localId));
  }

  const currentProjectUser = users.find((user) => user.email.toLowerCase() === authSession.user.email.toLowerCase()) ?? null;
  const isProjectAdmin = authSession.authKind === "postgres_admin";
  const canManageProjectSettings = isProjectAdmin || currentProjectUser?.role === "owner";
  const lastProjectActivityAt =
    [
      project.updatedAt,
      ...users.map((user) => user.updatedAt),
      ...objects.map((object) => object.updatedAt),
      ...relationships.map((relationship) => relationship.updatedAt),
    ]
      .filter(Boolean)
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? project.createdAt;
  const ownerCount = users.filter((user) => user.role === "owner").length;
  const canInviteUsers = isProjectAdmin || currentProjectUser?.role === "owner" || currentProjectUser?.role === "editor";
  const canChangeRoles = isProjectAdmin || currentProjectUser?.role === "owner";
  const canRemoveUsers = isProjectAdmin || currentProjectUser?.role === "owner";
  const canManageSources = isProjectAdmin || currentProjectUser?.role === "owner" || currentProjectUser?.role === "editor";
  const canManageAnnotations = isProjectAdmin || currentProjectUser?.role === "owner" || currentProjectUser?.role === "editor" || currentProjectUser?.role === "coder";
  const canManageMemos = canManageAnnotations;
  const availableAppUsers = useMemo(
    () => appUsers.filter((candidate) => !users.some((user) => user.appUserId === candidate.id)),
    [appUsers, users],
  );
  const inviteRoles = getInviteRoles();

  function projectRoleLabel(role: string) {
    return role.slice(0, 1).toUpperCase() + role.slice(1);
  }

  const userRoleSummaries = useMemo(
    () => PROJECT_ROLE_OPTIONS
      .map((role) => ({
        role,
        label: projectRoleLabel(role),
        count: users.filter((user) => user.role === role).length,
      }))
      .filter((summary) => summary.count > 0),
    [users],
  );

  const filteredProjectUsers = useMemo(
    () => selectedUserRoleFilter === "all"
      ? users
      : users.filter((user) => user.role === selectedUserRoleFilter),
    [selectedUserRoleFilter, users],
  );

  function getEditableRolesForUser(user: PostgresProjectUser) {
    if (!canChangeRoles) return [user.role];
    if (user.role === "owner" && !isProjectAdmin && ownerCount <= 1) return ["owner"];
    if (isProjectAdmin || currentProjectUser?.role === "owner") return [...PROJECT_ROLE_OPTIONS];
    return [user.role];
  }

  function getInviteRoles() {
    if (isProjectAdmin || currentProjectUser?.role === "owner") return [...PROJECT_ROLE_OPTIONS];
    return PROJECT_ROLE_OPTIONS.filter((role) => role !== "owner");
  }

  function getRemoveBlockReason(user: PostgresProjectUser) {
    if (!canRemoveUsers) return "You do not have permission to remove users from this project.";
    if (user.appUserId === authSession.user.id) return "You cannot remove your own account from this project.";
    if (user.role === "owner" && !isProjectAdmin && currentProjectUser?.role !== "owner") {
      return "Only project owners or administrators can remove a project owner.";
    }
    if (user.role === "owner" && ownerCount <= 1) return "A project must always have at least one owner.";
    return null;
  }

  useEffect(() => {
    let cancelled = false;

    async function loadUsers() {
      setUsersLoading(true);
      setUsersError("");
      try {
        const [nextUsers, nextAppUsers] = await Promise.all([
          listPostgresProjectUsers(project.id),
          listPostgresAppUsers(),
        ]);
        if (!cancelled) {
          setUsers(nextUsers);
          setAppUsers(nextAppUsers);
        }
      } catch (loadError) {
        if (!cancelled) {
          setUsers([]);
          setAppUsers([]);
          setUsersError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!cancelled) setUsersLoading(false);
      }
    }

    void loadUsers();
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  useEffect(() => {
    setCanvasStateLoaded(false);
    setCanvasSaveError("");
    clearSavedCanvasSession();
  }, [project.id]);

  useEffect(() => {
    if (!inviteRoles.includes(userRole)) {
      setUserRole(inviteRoles.includes("coder") ? "coder" : inviteRoles[0] ?? "viewer");
    }
  }, [inviteRoles, userRole]);

  useEffect(() => {
    let cancelled = false;

    async function loadGraph() {
      setGraphLoading(true);
      setGraphError("");
      try {
        const [
          nextObjectTypes,
          nextRelationshipTypes,
          nextObjects,
          nextSources,
          nextRelationships,
          nextObjectAttributeDefinitions,
          nextRelationshipAttributeDefinitions,
          nextSavedDrawings,
        ] = await Promise.all([
          listPostgresObjectTypes(project.id),
          listPostgresRelationshipTypes(project.id),
          listPostgresObjects(project.id),
          listPostgresSources(project.id),
          listPostgresRelationships(project.id),
          listPostgresObjectAttributeDefinitions(project.id),
          listPostgresRelationshipAttributeDefinitions(project.id),
          listPostgresSavedDrawingSummaries(project.id),
        ]);
        if (!cancelled) {
          setObjectTypes(nextObjectTypes);
          setRelationshipTypes(nextRelationshipTypes);
          setObjects(nextObjects);
          setSources(nextSources);
          setRelationships(nextRelationships);
          setObjectAttributeDefinitions(nextObjectAttributeDefinitions);
          setRelationshipAttributeDefinitions(nextRelationshipAttributeDefinitions);
          setSavedDrawings(nextSavedDrawings);
          setFromObjectId((current) => current || (nextObjects[0] ? `object:${nextObjects[0].id}` : ""));
          setToObjectId((current) => current || (nextObjects[1] ? `object:${nextObjects[1].id}` : nextObjects[0] ? `object:${nextObjects[0].id}` : ""));
          setRelationshipTypeId((current) => current || nextRelationshipTypes[0]?.id || "");
          setCanvasRelationshipTypeId((current) => current || nextRelationshipTypes[0]?.id || "");
        }
      } catch (loadError) {
        if (!cancelled) {
          setObjectTypes([]);
          setRelationshipTypes([]);
          setObjects([]);
          setSources([]);
          setRelationships([]);
          setObjectAttributeDefinitions([]);
          setRelationshipAttributeDefinitions([]);
          setSavedDrawings([]);
          setHiddenCanvasRelationshipIds([]);
          setGraphError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!cancelled) setGraphLoading(false);
      }
    }

    void loadGraph();
    return () => {
      cancelled = true;
    };
  }, [activeScreen, project.id]);

  useEffect(() => {
    if (activeScreen !== "explore") return;
    let cancelled = false;

    async function loadExploreCanvasState() {
      setCanvasSaveError("");
      setCanvasStateLoaded(false);
      try {
        const nextCanvasState = await getPostgresProjectCanvasState(project.id);
        if (cancelled) return;
        setCanvasScale(nextCanvasState.viewport.zoom || 1);
        setCanvasOffset({
          x: nextCanvasState.viewport.x || 140,
          y: nextCanvasState.viewport.y || 120,
        });
        setCanvasNodes(
          Object.fromEntries(
            nextCanvasState.nodes.map((node) => [node.id, node]),
          ),
        );
        setCanvasShapes(nextCanvasState.shapes);
        setHiddenCanvasRelationshipIds(nextCanvasState.hiddenRelationshipIds ?? []);
        setCanvasStateLoaded(true);
      } catch (loadError) {
        if (cancelled) return;
        setCanvasStateLoaded(false);
        setCanvasSaveError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    }

    void loadExploreCanvasState();
    return () => {
      cancelled = true;
    };
  }, [activeScreen, project.id]);

  const refreshUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError("");
    try {
      const [nextUsers, nextAppUsers] = await Promise.all([
        listPostgresProjectUsers(project.id),
        listPostgresAppUsers(),
      ]);
      setUsers(nextUsers);
      setAppUsers(nextAppUsers);
    } catch (loadError) {
      setUsers([]);
      setAppUsers([]);
      setUsersError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setUsersLoading(false);
    }
  }, [project.id]);

  const refreshSavedDrawings = useCallback(async () => {
    try {
      const nextSavedDrawings = await listPostgresSavedDrawingSummaries(project.id);
      setSavedDrawings(nextSavedDrawings);
    } catch (loadError) {
      setGraphError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, [project.id]);

  const openSavedDrawingSession = useCallback(
    async (drawingId: string, mode: "view" | "edit") => {
      setGraphError("");
      setGraphNotice("");
      setGraphSubmitting(true);
      try {
        const drawing = await getPostgresSavedDrawing(project.id, drawingId);
        if (drawing.canvasKind !== "free_draw") {
          setGraphError(`Opening saved ${formatCanvasKindLabel(drawing.canvasKind)} canvases is not wired yet.`);
          return;
        }
        setSavedCanvasSession({
          id: drawing.id,
          name: drawing.name,
          canvasKind: "free_draw",
          mode,
        });
        setCanvasScale(drawing.state.viewport.zoom || 1);
        setCanvasOffset({
          x: drawing.state.viewport.x || 140,
          y: drawing.state.viewport.y || 120,
        });
        setCanvasNodes(Object.fromEntries(drawing.state.nodes.map((node) => [node.id, node])));
        setCanvasShapes(drawing.state.shapes);
        setHiddenCanvasRelationshipIds(drawing.state.hiddenRelationshipIds ?? []);
        setCanvasStateLoaded(true);
        setCanvasSaveError("");
        setFreeDrawSaveNotice("");
        setFreeDrawSavedDrawingId(mode === "edit" ? drawing.id : null);
        setActiveScreen("free-draw");
      } catch (loadError) {
        setGraphError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        setGraphSubmitting(false);
      }
    },
    [project.id],
  );

  function buildSavedDrawingSvg(drawing: PostgresSavedDrawing, mode: "screen" | "pdf" = "screen") {
    const visibleNodeStates: PostgresCanvasNodeState[] = drawing.state.nodes;
    const visibleNodeIds = new Set(visibleNodeStates.map((node) => node.id));
    const visibleObjects = visibleNodeStates
      .map((nodeState) => {
        const object = objectById.get(nodeState.id);
        if (!object) return null;
        const objectTypeRecord = objectTypeById.get(object.objectTypeId) ?? null;
        return { nodeState, object, objectTypeRecord };
      })
      .filter((
        entry,
      ): entry is {
        nodeState: PostgresCanvasNodeState;
        object: PostgresObject;
        objectTypeRecord: PostgresObjectType | null;
      } => !!entry);
    const visibleRelationships = relationships.filter(
      (relationship) =>
        !drawing.state.hiddenRelationshipIds.includes(relationship.id)
        && visibleNodeIds.has(relationship.fromObjectId)
        && visibleNodeIds.has(relationship.toObjectId),
    );

    const shapeBounds = drawing.state.shapes.map((shape: PostgresCanvasShape) => {
      if (shape.kind === "pen") {
        const xs = shape.points.map((point: PostgresCanvasPoint) => point.x);
        const ys = shape.points.map((point: PostgresCanvasPoint) => point.y);
        return {
          left: Math.min(...xs, 0),
          top: Math.min(...ys, 0),
          right: Math.max(...xs, 0),
          bottom: Math.max(...ys, 0),
        };
      }
      return {
        left: shape.x,
        top: shape.y,
        right: shape.x + shape.width,
        bottom: shape.y + shape.height,
      };
    });

    const nodeBounds = visibleObjects.map(({ nodeState }: { nodeState: PostgresCanvasNodeState }) => ({
      left: nodeState.x,
      top: nodeState.y,
      right: nodeState.x + (nodeState.width || 220),
      bottom: nodeState.y + (nodeState.height || 110),
    }));

    const relationshipBounds = visibleRelationships.map((relationship) => {
      const source = visibleNodeStates.find((node: PostgresCanvasNodeState) => node.id === relationship.fromObjectId);
      const target = visibleNodeStates.find((node: PostgresCanvasNodeState) => node.id === relationship.toObjectId);
      if (!source || !target) {
        return { left: 0, top: 0, right: 0, bottom: 0 };
      }
      const sourceX = source.x + (source.width || 220) / 2;
      const sourceY = source.y + (source.height || 110) / 2;
      const targetX = target.x + (target.width || 220) / 2;
      const targetY = target.y + (target.height || 110) / 2;
      return {
        left: Math.min(sourceX, targetX),
        top: Math.min(sourceY, targetY),
        right: Math.max(sourceX, targetX),
        bottom: Math.max(sourceY, targetY),
      };
    });

    const allBounds = [...nodeBounds, ...shapeBounds, ...relationshipBounds];
    const padding = 48;
    const minX = allBounds.length ? Math.min(...allBounds.map((bound) => bound.left)) - padding : -padding;
    const minY = allBounds.length ? Math.min(...allBounds.map((bound) => bound.top)) - padding : -padding;
    const maxX = allBounds.length ? Math.max(...allBounds.map((bound) => bound.right)) + padding : 800 + padding;
    const maxY = allBounds.length ? Math.max(...allBounds.map((bound) => bound.bottom)) + padding : 600 + padding;
    const width = Math.max(320, maxX - minX);
    const height = Math.max(240, maxY - minY);

    const relationshipSvg = visibleRelationships.map((relationship, index) => {
      const source = visibleNodeStates.find((node: PostgresCanvasNodeState) => node.id === relationship.fromObjectId);
      const target = visibleNodeStates.find((node: PostgresCanvasNodeState) => node.id === relationship.toObjectId);
      if (!source || !target) return "";
      const sourceX = source.x + (source.width || 220) / 2 - minX;
      const sourceY = source.y + (source.height || 110) / 2 - minY;
      const targetX = target.x + (target.width || 220) / 2 - minX;
      const targetY = target.y + (target.height || 110) / 2 - minY;
      const relationshipTypeRecord = relationshipTypeById.get(relationship.relationshipTypeId) ?? null;
      const appearance = getPostgresRelationshipAppearance(relationship, relationshipTypeRecord);
      const markerEndId = `saved-end-${index}`;
      const markerStartId = `saved-start-${index}`;
      return `
        <defs>
          ${appearance.arrowhead === "none" ? "" : `<marker id="${markerEndId}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${appearance.color}" /></marker>`}
          ${appearance.arrowhead === "double_sided" ? `<marker id="${markerStartId}" markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto"><path d="M8,0 L0,4 L8,8 z" fill="${appearance.color}" /></marker>` : ""}
        </defs>
        <line
          x1="${sourceX}"
          y1="${sourceY}"
          x2="${targetX}"
          y2="${targetY}"
          stroke="${appearance.color}"
          stroke-width="${getPostgresRelationshipStrokeWidth(appearance.lineWeight)}"
          ${getPostgresRelationshipStrokeDasharray(appearance.lineShape) ? `stroke-dasharray="${getPostgresRelationshipStrokeDasharray(appearance.lineShape)}"` : ""}
          ${appearance.arrowhead === "none" ? "" : `marker-end="url(#${markerEndId})"`}
          ${appearance.arrowhead === "double_sided" ? `marker-start="url(#${markerStartId})"` : ""}
        />
        <text x="${(sourceX + targetX) / 2}" y="${(sourceY + targetY) / 2 - 8}" text-anchor="middle" font-size="12" font-weight="700" fill="${appearance.color}">${escapeSvgText(relationship.relationshipType)}</text>
      `;
    }).join("");

    const shapeSvg = drawing.state.shapes.map((shape: PostgresCanvasShape) => {
      return renderCanvasSketchShapeSvg(shape, minX, minY, mode);
    }).join("");

    const objectSvg = visibleObjects.map(({ nodeState, object, objectTypeRecord }: {
      nodeState: PostgresCanvasNodeState;
      object: PostgresObject;
      objectTypeRecord: PostgresObjectType | null;
    }) => {
      const appearance = getPostgresObjectAppearance(object, objectTypeRecord);
      const nodeWidth = nodeState.width || 220;
      const nodeHeight = nodeState.height || 110;
      const x = nodeState.x - minX;
      const y = nodeState.y - minY;
      const title = escapeSvgText(object.title || "Untitled object");
      const typeLabel = escapeSvgText(object.objectType || objectTypeRecord?.name || "");
      return `
        <g transform="translate(${x} ${y})">
          ${renderSvgObjectShape(appearance.shape, nodeWidth, nodeHeight, appearance.color, appearance.fill, appearance.sourceVisualKey)}
          <text x="${nodeWidth / 2}" y="${Math.max(28, nodeHeight / 2 - 6)}" text-anchor="middle" font-size="16" font-weight="700" fill="${appearance.fill === "filled" ? "#ffffff" : "#1f2933"}">${title}</text>
          <text x="${nodeWidth / 2}" y="${Math.max(48, nodeHeight / 2 + 16)}" text-anchor="middle" font-size="11" fill="${appearance.fill === "filled" ? "rgba(255,255,255,0.88)" : "#52606d"}">${typeLabel}</text>
        </g>
      `;
    }).join("");

    return {
      width,
      height,
      svg: `
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
          <rect width="${width}" height="${height}" fill="#f8fbff" />
          <g>${relationshipSvg}</g>
          <g>${shapeSvg}</g>
          <g>${objectSvg}</g>
        </svg>
      `,
    };
  }

  async function renderSavedDrawingCanvas(drawing: PostgresSavedDrawing): Promise<{
    canvas: HTMLCanvasElement;
    width: number;
    height: number;
  }> {
    const { svg, width, height } = buildSavedDrawingSvg(drawing, "screen");
    const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const nextImage = new Image();
        nextImage.onload = () => resolve(nextImage);
        nextImage.onerror = () => reject(new Error("Could not render saved canvas image."));
        nextImage.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(width);
      canvas.height = Math.ceil(height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not create export canvas context.");
      context.fillStyle = "#f8fbff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return {
        canvas,
        width: canvas.width,
        height: canvas.height,
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function renderSavedDrawingPngBytes(drawing: PostgresSavedDrawing): Promise<Uint8Array> {
    const { canvas } = await renderSavedDrawingCanvas(drawing);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((nextBlob) => {
        if (nextBlob) resolve(nextBlob);
        else reject(new Error("Could not encode saved canvas PNG."));
      }, "image/png");
    });
    return new Uint8Array(await blob.arrayBuffer());
  }

  async function handleExportSavedDrawing(format: "png" | "pdf") {
    const drawingSummary = savedDrawings.find((entry) => entry.id === exportingSavedDrawingId);
    if (!drawingSummary) return;
    setGraphError("");
    setSavedDrawingExportBusyFormat(format);
    try {
      const drawing = await getPostgresSavedDrawing(project.id, drawingSummary.id);
      const fileStem = sanitizeFileStem(drawing.name);
      if (format === "png") {
        const path = await save({
          defaultPath: `${fileStem}.png`,
          filters: [{ name: "PNG", extensions: ["png"] }],
        });
        if (!path) return;
        const pngBytes = await renderSavedDrawingPngBytes(drawing);
        await writeFile(path, pngBytes);
      } else {
        const path = await save({
          defaultPath: `${fileStem}.pdf`,
          filters: [{ name: "PDF", extensions: ["pdf"] }],
        });
        if (!path) return;
        const { jsPDF } = await loadJsPdf();
        await loadSvgToPdf();
        const { svg, width, height } = buildSavedDrawingSvg(drawing, "pdf");
        const svgDocument = new DOMParser().parseFromString(svg, "image/svg+xml");
        const svgElement = svgDocument.documentElement;
        if (!svgElement || svgElement.tagName.toLowerCase() !== "svg") {
          throw new Error("Could not prepare saved canvas SVG for PDF export.");
        }
        const pdf = new jsPDF({
          orientation: width >= height ? "landscape" : "portrait",
          unit: "pt",
          format: "letter",
        });
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const scale = Math.min((pageWidth - 48) / width, (pageHeight - 48) / height);
        const renderWidth = width * scale;
        const renderHeight = height * scale;
        await pdf.svg(svgElement, {
          x: 24,
          y: 24,
          width: renderWidth,
          height: renderHeight,
          loadExternalStyleSheets: false,
        });
        await writeFile(path, new Uint8Array(pdf.output("arraybuffer")));
      }
      setExportingSavedDrawingId(null);
      setGraphNotice(`Exported ${drawing.name} as ${format.toUpperCase()}.`);
    } catch (exportError) {
      setGraphError(exportError instanceof Error ? exportError.message : String(exportError));
    } finally {
      setSavedDrawingExportBusyFormat(null);
    }
  }

  async function handleDeleteSavedDrawing(drawingId: string) {
    setGraphError("");
    setGraphNotice("");
    setGraphSubmitting(true);
    try {
      await deletePostgresSavedDrawing(project.id, drawingId);
      setSavedDrawings((current) => current.filter((drawing) => drawing.id !== drawingId));
      if (savedCanvasSession?.id === drawingId) {
        clearSavedCanvasSession();
      }
      setRemovingSavedDrawingId(null);
      setGraphNotice("Deleted saved canvas.");
    } catch (deleteError) {
      setGraphError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setGraphSubmitting(false);
    }
  }

  async function handleCreateUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUsersError("");
    setUserNotice("");
    if (!selectedAppUserId) {
      setUsersError("Choose a registered user to add to this project.");
      return;
    }

    setUsersSubmitting(true);
    try {
      const created = await createPostgresProjectUser({
        projectId: project.id,
        appUserId: selectedAppUserId,
        role: userRole,
      });
      setUsers((current) => [...current, created]);
      setSelectedAppUserId("");
      setUserRole("coder");
      setAddUserOpen(false);
      setUserNotice(`Added ${created.name} to this PostgreSQL project.`);
      setActiveScreen("users");
    } catch (createError) {
      setUsersError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setUsersSubmitting(false);
    }
  }

  async function handleSaveUserRole(user: PostgresProjectUser) {
    setUsersError("");
    setUserNotice("");
    setUsersSubmitting(true);
    try {
      const updated = await updatePostgresProjectUser({
        projectId: project.id,
        projectUserId: user.id,
        role: editRole,
      });
      setUsers((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      setEditingUserId(null);
      setUserNotice(`Updated ${updated.name}'s role to ${projectRoleLabel(updated.role)}.`);
    } catch (updateError) {
      setUsersError(updateError instanceof Error ? updateError.message : String(updateError));
    } finally {
      setUsersSubmitting(false);
    }
  }

  async function handleRemoveUser(user: PostgresProjectUser) {
    const blockReason = getRemoveBlockReason(user);
    if (blockReason) {
      setUsersError(blockReason);
      return;
    }

    setUsersError("");
    setUserNotice("");
    setUsersSubmitting(true);
    try {
      await deletePostgresProjectUser(project.id, user.id);
      setUsers((current) => current.filter((entry) => entry.id !== user.id));
      setRemovingUserId(null);
      setUserNotice(`Removed ${user.name} from this PostgreSQL project.`);
    } catch (removeError) {
      setUsersError(removeError instanceof Error ? removeError.message : String(removeError));
    } finally {
      setUsersSubmitting(false);
    }
  }

  const refreshGraph = useCallback(async () => {
    setGraphLoading(true);
    setGraphError("");
    try {
      const [
        nextObjectTypes,
        nextRelationshipTypes,
        nextObjects,
        nextSources,
        nextRelationships,
        nextObjectAttributeDefinitions,
        nextRelationshipAttributeDefinitions,
        nextSavedDrawings,
        nextCanvasState,
      ] = await Promise.all([
        listPostgresObjectTypes(project.id),
        listPostgresRelationshipTypes(project.id),
        listPostgresObjects(project.id),
        listPostgresSources(project.id),
        listPostgresRelationships(project.id),
        listPostgresObjectAttributeDefinitions(project.id),
        listPostgresRelationshipAttributeDefinitions(project.id),
        listPostgresSavedDrawingSummaries(project.id),
        getPostgresProjectCanvasState(project.id),
      ]);
      setObjectTypes(nextObjectTypes);
      setRelationshipTypes(nextRelationshipTypes);
      setObjects(nextObjects);
      setSources(nextSources);
      setRelationships(nextRelationships);
      setObjectAttributeDefinitions(nextObjectAttributeDefinitions);
      setRelationshipAttributeDefinitions(nextRelationshipAttributeDefinitions);
      setSavedDrawings(nextSavedDrawings);
      setFromObjectId((current) => current || (nextObjects[0] ? `object:${nextObjects[0].id}` : ""));
      setToObjectId((current) => current || (nextObjects[1] ? `object:${nextObjects[1].id}` : nextObjects[0] ? `object:${nextObjects[0].id}` : ""));
      setRelationshipTypeId((current) => current || nextRelationshipTypes[0]?.id || "");
      setCanvasRelationshipTypeId((current) => current || nextRelationshipTypes[0]?.id || "");
      if (activeScreen !== "free-draw") {
        setCanvasScale(nextCanvasState.viewport.zoom || 1);
        setCanvasOffset({
          x: nextCanvasState.viewport.x || 140,
          y: nextCanvasState.viewport.y || 120,
        });
        setCanvasNodes(Object.fromEntries(nextCanvasState.nodes.map((node) => [node.id, node])));
        setCanvasShapes(nextCanvasState.shapes);
        setHiddenCanvasRelationshipIds(nextCanvasState.hiddenRelationshipIds ?? []);
      }
      setCanvasStateLoaded(true);
    } catch (loadError) {
      setObjectTypes([]);
      setRelationshipTypes([]);
      setObjects([]);
      setSources([]);
      setRelationships([]);
      setObjectAttributeDefinitions([]);
      setRelationshipAttributeDefinitions([]);
      setSavedDrawings([]);
      setHiddenCanvasRelationshipIds([]);
      setCanvasStateLoaded(false);
      setGraphError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setGraphLoading(false);
    }
  }, [activeScreen, project.id]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    async function subscribeToProjectChanges() {
      unlisten = await listen<PostgresProjectChangeEvent>(POSTGRES_PROJECT_CHANGED_EVENT, (event) => {
        if (disposed) return;
        if (event.payload.projectId !== project.id) return;

        if (event.payload.entityType === "saved_drawing") {
          if (activeScreen !== "free-draw") {
            void refreshSavedDrawings();
          }
          return;
        }

        if (activeScreen === "users") {
          void refreshUsers();
          return;
        }

        if (activeScreen === "objects" || activeScreen === "relationships") {
          if (pendingLocalGraphRefreshSkipsRef.current > 0) {
            pendingLocalGraphRefreshSkipsRef.current -= 1;
            return;
          }
          void refreshGraph();
          return;
        }

        if (activeScreen === "explore") {
          return;
        }

        void refreshUsers();
        void refreshGraph();
      });
    }

    void subscribeToProjectChanges();
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [activeScreen, project.id, refreshGraph, refreshSavedDrawings, refreshUsers]);

  useEffect(() => {
    if (selectedObjectTypeFilter === "all") return;
    if (!objectTypes.some((objectType) => objectType.id === selectedObjectTypeFilter)) {
      setSelectedObjectTypeFilter("all");
    }
  }, [objectTypes, selectedObjectTypeFilter]);

  useEffect(() => {
    if (selectedRelationshipTypeFilter === "all") return;
    if (!relationshipTypes.some((relationshipType) => relationshipType.id === selectedRelationshipTypeFilter)) {
      setSelectedRelationshipTypeFilter("all");
    }
  }, [relationshipTypes, selectedRelationshipTypeFilter]);

  useEffect(() => {
    if (!openObjectTypeActionsMenu && !openObjectActionsMenu && !openRelationshipTypeActionsMenu && !openRelationshipActionsMenu && !openSavedDrawingActionsMenu) return;

    function handleDismiss() {
      setOpenObjectTypeActionsMenu(null);
      setOpenObjectActionsMenu(null);
      setOpenRelationshipTypeActionsMenu(null);
      setOpenRelationshipActionsMenu(null);
      setOpenSavedDrawingActionsMenu(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        handleDismiss();
      }
    }

    window.addEventListener("click", handleDismiss);
    window.addEventListener("resize", handleDismiss);
    window.addEventListener("scroll", handleDismiss, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", handleDismiss);
      window.removeEventListener("resize", handleDismiss);
      window.removeEventListener("scroll", handleDismiss, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openObjectActionsMenu, openObjectTypeActionsMenu, openRelationshipActionsMenu, openRelationshipTypeActionsMenu, openSavedDrawingActionsMenu]);

  useEffect(() => {
    if (relationshipTypeId && relationshipTypes.some((relationshipType) => relationshipType.id === relationshipTypeId)) {
      return;
    }
    setRelationshipTypeId(relationshipTypes[0]?.id ?? "");
  }, [relationshipTypeId, relationshipTypes]);

  useEffect(() => {
    if (canvasRelationshipTypeId && relationshipTypes.some((relationshipType) => relationshipType.id === canvasRelationshipTypeId)) {
      return;
    }
    setCanvasRelationshipTypeId(relationshipTypes[0]?.id ?? "");
  }, [canvasRelationshipTypeId, relationshipTypes]);

  useEffect(() => {
    if (fromObjectId && availableFromEndpointOptions.some((option) => option.key === fromObjectId)) return;
    setFromObjectId(availableFromEndpointOptions[0]?.key ?? "");
  }, [availableFromEndpointOptions, fromObjectId]);

  useEffect(() => {
    if (toObjectId && availableToEndpointOptions.some((option) => option.key === toObjectId)) return;
    setToObjectId(availableToEndpointOptions[0]?.key ?? "");
  }, [availableToEndpointOptions, toObjectId]);

  useEffect(() => {
    if (editingRelationshipId === null) return;
    if (editingRelationshipFromObjectId && availableEditingFromObjects.some((object) => object.id === editingRelationshipFromObjectId)) return;
    setEditingRelationshipFromObjectId(availableEditingFromObjects[0]?.id ?? "");
  }, [availableEditingFromObjects, editingRelationshipFromObjectId, editingRelationshipId]);

  useEffect(() => {
    if (editingRelationshipId === null) return;
    if (editingRelationshipToObjectId && availableEditingToObjects.some((object) => object.id === editingRelationshipToObjectId)) return;
    setEditingRelationshipToObjectId(availableEditingToObjects[0]?.id ?? "");
  }, [availableEditingToObjects, editingRelationshipId, editingRelationshipToObjectId]);

  useEffect(() => {
    if (activeScreen !== "explore") return;
    setCanvasNodes((current) => {
      const objectTypeById = new Map(objectTypes.map((objectType) => [objectType.id, objectType]));
      const next: Record<string, PostgresCanvasNodeState> = {};
      objects.forEach((object, index) => {
        const existing = current[object.id];
        if (existing) {
          next[object.id] = existing;
          return;
        }
        const objectTypeRecord = objectTypeById.get(object.objectTypeId) ?? null;
        const shape = getPostgresObjectAppearance(object, objectTypeRecord).shape;
        const defaultDimensions = getCanvasNodeDefaultDimensions(shape);
        const column = index % 4;
        const row = Math.floor(index / 4);
        next[object.id] = {
          id: object.id,
          x: column * 260,
          y: row * 180,
          width: defaultDimensions.width,
          height: defaultDimensions.height,
        };
      });
      return areCanvasNodeMapsEqual(current, next) ? current : next;
    });
  }, [activeScreen, objectTypes, objects]);

  useEffect(() => {
    if (!canvasStateLoaded || activeScreen !== "explore") return;
    const timeoutId = window.setTimeout(() => {
      void savePostgresProjectCanvasState({
        projectId: project.id,
        state: {
          viewport: {
            x: canvasOffset.x,
            y: canvasOffset.y,
            zoom: canvasScale,
          },
          nodes: Object.values(canvasNodes),
          shapes: canvasShapes,
          hiddenRelationshipIds: hiddenCanvasRelationshipIds,
        },
      }).then(() => {
        setCanvasSaveError("");
      }).catch((error) => {
        setCanvasSaveError(error instanceof Error ? error.message : String(error));
      });
    }, 500);

    return () => window.clearTimeout(timeoutId);
  }, [activeScreen, canvasNodes, canvasOffset.x, canvasOffset.y, canvasScale, canvasShapes, canvasStateLoaded, hiddenCanvasRelationshipIds, project.id]);

  useEffect(() => {
    if (activeScreen !== "free-draw") return;
    if (savedCanvasSession?.canvasKind === "free_draw") return;
    resetFreeDrawCanvasSession();
  }, [activeScreen, resetFreeDrawCanvasSession, savedCanvasSession?.canvasKind]);

  useEffect(() => {
    setHiddenCanvasRelationshipIds((current) =>
      current.filter((relationshipId) => relationships.some((relationship) => relationship.id === relationshipId)),
    );
  }, [relationships]);

  function toObjectAttributePayload(
    definitions: PostgresObjectAttributeDefinition[],
    valuesByDefinitionId: Record<string, string>,
  ) {
    return definitions.map((definition) => ({
      attributeDefinitionId: definition.id,
      value: valuesByDefinitionId[definition.id] ?? "",
    }));
  }

  function valuesForObject(object: PostgresObject): Record<string, string> {
    const valuesByDefinitionId: Record<string, string> = {};
    for (const value of object.attributeValues) {
      valuesByDefinitionId[value.attributeDefinitionId] = value.value;
    }
    return valuesByDefinitionId;
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

  function valuesForRelationship(relationship: PostgresRelationship): Record<string, string> {
    const valuesByDefinitionId: Record<string, string> = {};
    for (const value of relationship.attributeValues) {
      valuesByDefinitionId[value.attributeDefinitionId] = value.value;
    }
    return valuesByDefinitionId;
  }

  async function handleSaveRelationshipAttributeDefinition(
    draft: PostgresRelationshipAttributeDraft,
    valuesByRelationshipId: Record<string, string>,
  ) {
    if (!editingRelationshipAttributeTypeId) {
      setRelationshipAttributeEditorError("Choose a relationship type first.");
      return;
    }
    setGraphSubmitting(true);
    setGraphError("");
    setGraphNotice("");
    setRelationshipAttributeEditorError("");
    try {
      const savedDefinition = draft.id
        ? await updatePostgresRelationshipAttributeDefinition({
            projectId: project.id,
            attributeDefinitionId: draft.id,
            relationshipTypeId: editingRelationshipAttributeTypeId,
            name: draft.name,
            dataType: draft.dataType,
            description: draft.description,
            options: draft.options,
          })
        : await createPostgresRelationshipAttributeDefinition({
            projectId: project.id,
            relationshipTypeId: editingRelationshipAttributeTypeId,
            name: draft.name,
            dataType: draft.dataType,
            description: draft.description,
            options: draft.options,
          });

      await Promise.all(
        relationships
          .filter((relationship) => relationship.relationshipTypeId === editingRelationshipAttributeTypeId)
          .map((relationship) =>
          savePostgresRelationship({
            projectId: project.id,
            relationshipId: relationship.id,
            fromObjectId: relationship.fromObjectId,
            toObjectId: relationship.toObjectId,
            relationshipTypeId: relationship.relationshipTypeId,
            description: relationship.description,
            lineShapeOverride: relationship.lineShapeOverride || null,
            lineWeightOverride: relationship.lineWeightOverride,
            arrowheadOverride: relationship.arrowheadOverride || null,
            colorOverride: relationship.colorOverride || null,
            attributeValues: [
              ...relationship.attributeValues
                .filter((value) => value.attributeDefinitionId !== savedDefinition.id)
                .map((value) => ({
                  attributeDefinitionId: value.attributeDefinitionId,
                  value: value.value,
                })),
              {
                attributeDefinitionId: savedDefinition.id,
                value: valuesByRelationshipId[relationship.id] ?? "",
              },
            ],
          })),
      );

      await refreshGraph();
      setRelationshipAttributeEditorDraft(null);
      setEditingRelationshipAttributeTypeId(null);
      setRelationshipAttributeEditorError("");
      setGraphNotice(draft.id ? `Updated relationship attribute "${savedDefinition.name}".` : `Created relationship attribute "${savedDefinition.name}".`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRelationshipAttributeEditorError(message);
      setGraphError(message);
    } finally {
      setGraphSubmitting(false);
    }
  }

  async function handleCreateObjectWorkspaceAttribute(draft: TypeScopedAttributeDraft) {
    setGraphSubmitting(true);
    setGraphError("");
    setGraphNotice("");
    setObjectWorkspaceAttributeError("");
    try {
      await Promise.all(
        draft.typeIds.map((objectTypeId) =>
          createPostgresObjectAttributeDefinition({
            projectId: project.id,
            objectTypeId,
            name: draft.name,
            dataType: draft.dataType,
            description: draft.description,
            options: draft.options,
          }),
        ),
      );
      await refreshGraph();
      setObjectWorkspaceAttributeDraft(null);
      setGraphNotice(
        draft.typeIds.length === 1
          ? `Created object attribute "${draft.name}".`
          : `Created object attribute "${draft.name}" for ${draft.typeIds.length} object types.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setObjectWorkspaceAttributeError(message);
      setGraphError(message);
    } finally {
      setGraphSubmitting(false);
    }
  }

  async function handleCreateRelationshipWorkspaceAttribute(draft: TypeScopedAttributeDraft) {
    setGraphSubmitting(true);
    setGraphError("");
    setGraphNotice("");
    setRelationshipWorkspaceAttributeError("");
    try {
      await Promise.all(
        draft.typeIds.map((relationshipTypeId) =>
          createPostgresRelationshipAttributeDefinition({
            projectId: project.id,
            relationshipTypeId,
            name: draft.name,
            dataType: draft.dataType,
            description: draft.description,
            options: draft.options,
          }),
        ),
      );
      await refreshGraph();
      setRelationshipWorkspaceAttributeDraft(null);
      setGraphNotice(
        draft.typeIds.length === 1
          ? `Created relationship attribute "${draft.name}".`
          : `Created relationship attribute "${draft.name}" for ${draft.typeIds.length} relationship types.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRelationshipWorkspaceAttributeError(message);
      setGraphError(message);
    } finally {
      setGraphSubmitting(false);
    }
  }

  async function handleCreateObject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGraphError("");
    setGraphNotice("");
    if (!objectTypeId || !objectTitle.trim()) {
      setGraphError("Enter an object type and title.");
      return;
    }

    setGraphSubmitting(true);
    try {
      pendingLocalGraphRefreshSkipsRef.current = 1;
      let created = await savePostgresObject({
        projectId: project.id,
        objectId: null,
        objectTypeId,
        title: objectTitle.trim(),
        description: objectDescription.trim(),
        shapeOverride: objectGraphicMode === "select" ? objectShapeOverride.trim() || null : null,
        colorOverride: objectGraphicMode === "select" ? normalizeOptionalPostgresObjectTypeColor(objectColorOverride) || null : null,
        fillOverride: objectGraphicMode === "select" ? objectFillOverride.trim() || null : null,
        imageStoragePath: objectGraphicMode === "upload" ? objectImageStoragePath.trim() || null : null,
        attributeValues: toObjectAttributePayload(objectAttributeDefinitionsForCreateType, objectAttributeValues),
      });
      if (objectGraphicMode === "upload" && draftObjectPendingImage) {
        try {
          created = await importPostgresObjectImage({
            projectId: project.id,
            objectId: created.id,
            originalFileName: draftObjectPendingImage.originalFileName,
            fileBytesBase64: draftObjectPendingImage.fileBytesBase64,
          });
        } catch (uploadError) {
          setGraphError(uploadError instanceof Error ? uploadError.message : String(uploadError));
        }
      }
      setObjects((current) => [...current, created]);
      setObjectTitle("");
      setObjectDescription("");
      setObjectShapeOverride("");
      setObjectColorOverride("");
      setObjectFillOverride("");
      setObjectImageStoragePath("");
      setDraftObjectPendingImage(null);
      setObjectGraphicMode("inherit");
      setObjectAttributeValues({});
      setSelectedObjectTypeFilter(created.objectTypeId || "all");
      closeCreateObjectModal();
      if (pendingCanvasNodePosition) {
        const objectTypeRecord = objectTypeById.get(created.objectTypeId) ?? null;
        const shape = getPostgresObjectAppearance(created, objectTypeRecord).shape;
        const defaultDimensions = getCanvasNodeDefaultDimensions(shape);
        setCanvasNodes((current) => ({
          ...current,
          [created.id]: {
            id: created.id,
            x: pendingCanvasNodePosition.x,
            y: pendingCanvasNodePosition.y,
            width: current[created.id]?.width ?? defaultDimensions.width,
            height: current[created.id]?.height ?? defaultDimensions.height,
          },
        }));
        setPendingCanvasNodePosition(null);
      }
      setFromObjectId((current) => current || created.id);
      setToObjectId((current) => current || created.id);
    } catch (createError) {
      pendingLocalGraphRefreshSkipsRef.current = 0;
      setGraphError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setGraphSubmitting(false);
    }
  }

  async function handleCreateObjectType(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextType = draftObjectTypeName.trim();
    setGraphError("");
    setGraphNotice("");
    if (!nextType) {
      setGraphError("Enter an object type name.");
      return;
    }

    const existingType = objectTypeSummaries.find((summary) => summary.objectType.toLowerCase() === nextType.toLowerCase());
    const resolvedType = existingType?.objectType ?? nextType;
    if (existingType) {
      const existingTypeRecord = objectTypes.find((objectType) => objectType.name.toLowerCase() === resolvedType.toLowerCase());
      setDraftObjectTypeName("");
      setDraftObjectTypeDescription("");
      setDraftObjectTypeShape("rounded");
      setDraftObjectTypeColor(POSTGRES_OBJECT_TYPE_DEFAULT_COLOR);
      setDraftObjectTypeFill("filled");
      setDraftObjectTypeImageStoragePath("");
      setDraftObjectTypePendingImage(null);
      setDraftObjectTypeGraphicMode("select");
      initializeObjectTypeAttributeEditor(null);
      setObjectTypeModalTab("details");
      setCreateObjectTypeOpen(false);
      setSelectedObjectTypeFilter(existingTypeRecord?.id ?? "all");
      setObjectTypeId(existingTypeRecord?.id ?? "");
      setObjectTitle("");
      setObjectDescription("");
      setObjectAttributeValues({});
      setGraphNotice(`Switched to existing object type "${resolvedType}".`);
      return;
    }

    setGraphSubmitting(true);
    try {
      pendingLocalGraphRefreshSkipsRef.current = 1;
      const saved = await savePostgresObjectType({
        projectId: project.id,
        objectTypeId: null,
        name: resolvedType,
        description: draftObjectTypeDescription.trim(),
        shape: draftObjectTypeShape,
        color: normalizePostgresObjectTypeColor(draftObjectTypeColor),
        fill: draftObjectTypeFill,
        imageStoragePath: draftObjectTypeImageStoragePath.trim() || null,
        attributes: objectTypeAttributeDrafts.map((draft) => ({
          id: draft.id || null,
          name: draft.name,
          dataType: draft.dataType,
          description: draft.description,
          options: draft.options,
        })),
      });
      let savedObjectType = saved.objectType;
      if (draftObjectTypePendingImage) {
        try {
          savedObjectType = await importPostgresObjectTypeImage({
            projectId: project.id,
            objectTypeId: saved.objectType.id,
            originalFileName: draftObjectTypePendingImage.originalFileName,
            fileBytesBase64: draftObjectTypePendingImage.fileBytesBase64,
          });
        } catch (uploadError) {
          setGraphError(uploadError instanceof Error ? uploadError.message : String(uploadError));
        }
      }
      applySavedObjectTypeState(savedObjectType, saved.attributeDefinitions);
      setDraftObjectTypeName("");
      setDraftObjectTypeDescription("");
      setDraftObjectTypeShape("rounded");
      setDraftObjectTypeColor(POSTGRES_OBJECT_TYPE_DEFAULT_COLOR);
      setDraftObjectTypeFill("filled");
      setDraftObjectTypeImageStoragePath("");
      setDraftObjectTypePendingImage(null);
      setDraftObjectTypeGraphicMode("select");
      initializeObjectTypeAttributeEditor(null);
      setObjectTypeModalTab("details");
      setCreateObjectTypeOpen(false);
      setSelectedObjectTypeFilter(savedObjectType.id);
      setObjectTypeId(savedObjectType.id);
      setObjectTitle("");
      setObjectDescription("");
      setObjectAttributeValues({});
      setGraphNotice(`Created object type "${savedObjectType.name}".`);
    } catch (error) {
      pendingLocalGraphRefreshSkipsRef.current = 0;
      setGraphError(error instanceof Error ? error.message : String(error));
    } finally {
      setGraphSubmitting(false);
    }
  }

  function requestPostgresImageCropChoice(upload: PostgresImageUploadDraft): Promise<PostgresImageUploadDraft | null> {
    return new Promise((resolve) => {
      imageCropResolverRef.current = resolve;
      setImageCropDraft({
        upload,
        mode: "full",
        aspect: "original",
        sizePercent: 100,
        xPercent: 50,
        yPercent: 50,
        error: "",
      });
    });
  }

  function resolvePostgresImageCropChoice(upload: PostgresImageUploadDraft | null) {
    imageCropResolverRef.current?.(upload);
    imageCropResolverRef.current = null;
    setImageCropDraft(null);
  }

  function handleCancelPostgresImageCropChoice() {
    if (imageCropDraft?.upload.previewUrl) {
      URL.revokeObjectURL(imageCropDraft.upload.previewUrl);
    }
    resolvePostgresImageCropChoice(null);
  }

  function handleUseFullPostgresImage() {
    if (!imageCropDraft) return;
    if (imageCropDraft.upload.fileSizeBytes > POSTGRES_IMAGE_MAX_BYTES) {
      setImageCropDraft({
        ...imageCropDraft,
        error: `This image is ${formatPostgresFileSize(imageCropDraft.upload.fileSizeBytes)}. Choose a file smaller than 5 MB or select a smaller region.`,
      });
      return;
    }
    resolvePostgresImageCropChoice(imageCropDraft.upload);
  }

  async function handleUseCroppedPostgresImage() {
    if (!imageCropDraft) return;
    setImageCropSubmitting(true);
    try {
      const cropped = await cropPostgresImageUpload(
        imageCropDraft.upload,
        imageCropDraft.aspect,
        imageCropDraft.sizePercent,
        imageCropDraft.xPercent,
        imageCropDraft.yPercent,
      );
      if (cropped.fileSizeBytes > POSTGRES_IMAGE_MAX_BYTES) {
        URL.revokeObjectURL(cropped.previewUrl);
        setImageCropDraft({
          ...imageCropDraft,
          error: `The selected region is still ${formatPostgresFileSize(cropped.fileSizeBytes)}. Select a smaller region or choose a smaller file.`,
        });
        return;
      }
      URL.revokeObjectURL(imageCropDraft.upload.previewUrl);
      resolvePostgresImageCropChoice(cropped);
    } catch (error) {
      setImageCropDraft({
        ...imageCropDraft,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setImageCropSubmitting(false);
    }
  }

  async function pickObjectImageUpload(): Promise<PostgresImageUploadDraft | null> {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg"] }],
    });
    if (!selected || Array.isArray(selected)) return null;
    const bytes = await readTauriFile(selected);
    const originalFileName = getFileNameFromPath(selected);
    const previewBlob = new Blob([bytes], { type: getPostgresImageMimeType(originalFileName) });
    const upload = {
      originalFileName,
      fileBytesBase64: bytesToBase64(bytes),
      previewUrl: URL.createObjectURL(previewBlob),
      fileSizeBytes: bytes.length,
    };
    return requestPostgresImageCropChoice(upload);
  }

  async function handlePickPendingObjectTypeImage() {
    setGraphError("");
    setGraphNotice("");
    setImageUploadSubmitting(true);
    try {
      const upload = await pickObjectImageUpload();
      if (!upload) return;
      setDraftObjectTypePendingImage(upload);
      setDraftObjectTypeImageStoragePath("");
      setDraftObjectTypeGraphicMode("upload");
    } catch (error) {
      setGraphError(error instanceof Error ? error.message : String(error));
    } finally {
      setImageUploadSubmitting(false);
    }
  }

  function handleRemovePendingObjectTypeImage() {
    setDraftObjectTypePendingImage(null);
    setDraftObjectTypeImageStoragePath("");
    setDraftObjectTypeGraphicMode("select");
  }

  async function handlePickPendingObjectImage() {
    setGraphError("");
    setGraphNotice("");
    setImageUploadSubmitting(true);
    try {
      const upload = await pickObjectImageUpload();
      if (!upload) return;
      setDraftObjectPendingImage(upload);
      setObjectImageStoragePath("");
      setObjectGraphicMode("upload");
    } catch (error) {
      setGraphError(error instanceof Error ? error.message : String(error));
    } finally {
      setImageUploadSubmitting(false);
    }
  }

  function handleRemovePendingObjectImage() {
    setDraftObjectPendingImage(null);
    setObjectImageStoragePath("");
  }

  function handleSetObjectTypeGraphicMode(mode: PostgresObjectGraphicMode) {
    setDraftObjectTypeGraphicMode(mode);
    if (mode === "select") {
      if (editingObjectTypeModalId && draftObjectTypeImageStoragePath) {
        void handleRemoveObjectTypeImage(editingObjectTypeModalId);
      } else {
        setDraftObjectTypePendingImage(null);
        setDraftObjectTypeImageStoragePath("");
      }
    }
  }

  function handleSetObjectGraphicMode(
    mode: PostgresObjectInstanceGraphicMode,
    config: {
      setMode: Dispatch<SetStateAction<PostgresObjectInstanceGraphicMode>>;
      setShapeOverride: Dispatch<SetStateAction<string>>;
      setColorOverride: Dispatch<SetStateAction<string>>;
      setFillOverride: Dispatch<SetStateAction<string>>;
      setImageStoragePath: Dispatch<SetStateAction<string>>;
      onClearPendingImage?: () => void;
      objectId?: string | null;
    },
  ) {
    config.setMode(mode);
    if (mode === "inherit") {
      config.setShapeOverride("");
      config.setColorOverride("");
      config.setFillOverride("");
      if (config.objectId && config.objectId === editingObjectId && editingObjectImageStoragePath) {
        void handleRemoveEditingObjectImage(config.objectId);
      } else {
        config.setImageStoragePath("");
        config.onClearPendingImage?.();
      }
    }
    if (mode === "select") {
      if (config.objectId && config.objectId === editingObjectId && editingObjectImageStoragePath) {
        void handleRemoveEditingObjectImage(config.objectId);
      } else {
        config.setImageStoragePath("");
        config.onClearPendingImage?.();
      }
    }
    if (mode === "upload") {
      config.setShapeOverride("");
      config.setColorOverride("");
      config.setFillOverride("");
    }
  }

  async function handleImportObjectTypeImage(objectTypeId: string) {
    setGraphError("");
    setGraphNotice("");
    setImageUploadSubmitting(true);
    try {
      const upload = await pickObjectImageUpload();
      if (!upload) return;
      const updated = await importPostgresObjectTypeImage({
        projectId: project.id,
        objectTypeId,
        ...upload,
      });
      URL.revokeObjectURL(upload.previewUrl);
      setObjectTypes((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      setDraftObjectTypeImageStoragePath(updated.imageStoragePath ?? "");
      setDraftObjectTypeGraphicMode("upload");
      setGraphNotice(`Updated image for "${updated.name}".`);
    } catch (error) {
      setGraphError(error instanceof Error ? error.message : String(error));
    } finally {
      setImageUploadSubmitting(false);
    }
  }

  async function handleRemoveObjectTypeImage(objectTypeId: string) {
    setGraphError("");
    setGraphNotice("");
    setImageUploadSubmitting(true);
    try {
      const updated = await removePostgresObjectTypeImage(project.id, objectTypeId);
      setObjectTypes((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      setDraftObjectTypeImageStoragePath("");
      setDraftObjectTypeGraphicMode("select");
      setGraphNotice(`Removed image for "${updated.name}".`);
    } catch (error) {
      setGraphError(error instanceof Error ? error.message : String(error));
    } finally {
      setImageUploadSubmitting(false);
    }
  }

  async function handleImportEditingObjectImage(objectId: string) {
    setGraphError("");
    setGraphNotice("");
    setImageUploadSubmitting(true);
    try {
      const upload = await pickObjectImageUpload();
      if (!upload) return;
      const updated = await importPostgresObjectImage({
        projectId: project.id,
        objectId,
        ...upload,
      });
      URL.revokeObjectURL(upload.previewUrl);
      setObjects((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      setEditingObjectImageStoragePath(updated.imageStoragePath ?? "");
      setEditingObjectGraphicMode("upload");
      setGraphNotice(`Updated image for "${updated.title}".`);
    } catch (error) {
      setGraphError(error instanceof Error ? error.message : String(error));
    } finally {
      setImageUploadSubmitting(false);
    }
  }

  async function handleRemoveEditingObjectImage(objectId: string) {
    setGraphError("");
    setGraphNotice("");
    setImageUploadSubmitting(true);
    try {
      const updated = await removePostgresObjectImage(project.id, objectId);
      setObjects((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      setEditingObjectImageStoragePath("");
      setEditingObjectGraphicMode(
        editingObjectShapeOverride || editingObjectColorOverride || editingObjectFillOverride ? "select" : "inherit",
      );
      setGraphNotice(`Removed image for "${updated.title}".`);
    } catch (error) {
      setGraphError(error instanceof Error ? error.message : String(error));
    } finally {
      setImageUploadSubmitting(false);
    }
  }

  async function handleSaveObjectType(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingObjectTypeModalId) return;
    const nextType = draftObjectTypeName.trim();
    setGraphError("");
    setGraphNotice("");
    if (!nextType) {
      setGraphError("Enter an object type name.");
      return;
    }

    setGraphSubmitting(true);
    try {
      pendingLocalGraphRefreshSkipsRef.current = 1;
      const saved = await savePostgresObjectType({
        projectId: project.id,
        objectTypeId: editingObjectTypeModalId,
        name: nextType,
        description: draftObjectTypeDescription.trim(),
        shape: draftObjectTypeShape,
        color: normalizePostgresObjectTypeColor(draftObjectTypeColor),
        fill: draftObjectTypeFill,
        imageStoragePath: draftObjectTypeImageStoragePath.trim() || null,
        attributes: objectTypeAttributeDrafts.map((draft) => ({
          id: draft.id || null,
          name: draft.name,
          dataType: draft.dataType,
          description: draft.description,
          options: draft.options,
        })),
      });
      applySavedObjectTypeState(saved.objectType, saved.attributeDefinitions);
      setEditingObjectTypeModalId(null);
      setDraftObjectTypeName("");
      setDraftObjectTypeDescription("");
      setDraftObjectTypeShape("rounded");
      setDraftObjectTypeColor(POSTGRES_OBJECT_TYPE_DEFAULT_COLOR);
      setDraftObjectTypeFill("filled");
      setDraftObjectTypeImageStoragePath("");
      initializeObjectTypeAttributeEditor(null);
      setObjectTypeModalTab("details");
      setGraphNotice(`Updated object type "${saved.objectType.name}".`);
    } catch (error) {
      pendingLocalGraphRefreshSkipsRef.current = 0;
      setGraphError(error instanceof Error ? error.message : String(error));
    } finally {
      setGraphSubmitting(false);
    }
  }

  async function handleDeleteObjectType(objectTypeId: string) {
    setGraphSubmitting(true);
    setGraphError("");
    setGraphNotice("");
    try {
      const objectTypeRecord = objectTypeById.get(objectTypeId);
      await deletePostgresObjectType(project.id, objectTypeId);
      await refreshGraph();
      setOpenObjectTypeActionsMenu(null);
      setRemovingObjectTypeId(null);
      setSelectedObjectTypeFilter((current) => (current === objectTypeId ? "all" : current));
      setGraphNotice(`Deleted object type "${objectTypeRecord?.name ?? "Untitled"}".`);
    } catch (error) {
      setGraphError(error instanceof Error ? error.message : String(error));
    } finally {
      setGraphSubmitting(false);
    }
  }

  async function handleSaveObject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingObjectId || !editingObjectTypeId || !editingObjectTitle.trim()) {
      setGraphError("Enter an object type and title.");
      return;
    }

    setGraphSubmitting(true);
    setGraphError("");
    setGraphNotice("");
    try {
      console.warn("[kanqual] handleSaveObject:start", {
        editingObjectId,
        editingObjectTypeId,
        editingObjectTitle,
        attributeDefinitionIds: objectAttributeDefinitionsForEditingType.map((definition) => definition.id),
        attributeValueKeys: Object.keys(editingObjectAttributeValues),
      });
      pendingLocalGraphRefreshSkipsRef.current = 1;
      const updated = await savePostgresObject({
        projectId: project.id,
        objectId: editingObjectId,
        objectTypeId: editingObjectTypeId,
        title: editingObjectTitle.trim(),
        description: editingObjectDescription.trim(),
        shapeOverride: editingObjectGraphicMode === "select" ? editingObjectShapeOverride.trim() || null : null,
        colorOverride: editingObjectGraphicMode === "select" ? normalizeOptionalPostgresObjectTypeColor(editingObjectColorOverride) || null : null,
        fillOverride: editingObjectGraphicMode === "select" ? editingObjectFillOverride.trim() || null : null,
        imageStoragePath: editingObjectGraphicMode === "upload" ? editingObjectImageStoragePath.trim() || null : null,
        attributeValues: toObjectAttributePayload(objectAttributeDefinitionsForEditingType, editingObjectAttributeValues),
      });
      console.warn("[kanqual] handleSaveObject:success", {
        updatedId: updated.id,
        updatedObjectTypeId: updated.objectTypeId,
        updatedAttributeValueCount: updated.attributeValues.length,
      });
      setObjects((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      setEditingObjectId(null);
      setEditingObjectAttributeValues({});
    } catch (updateError) {
      pendingLocalGraphRefreshSkipsRef.current = 0;
      console.error("[kanqual] handleSaveObject:error", updateError);
      setGraphError(updateError instanceof Error ? updateError.message : String(updateError));
    } finally {
      setGraphSubmitting(false);
    }
  }

  async function handleDeleteObject(objectId: string) {
    setGraphSubmitting(true);
    setGraphError("");
    setGraphNotice("");
    try {
      await deletePostgresObject(project.id, objectId);
      setObjects((current) => current.filter((entry) => entry.id !== objectId));
      setRelationships((current) =>
        current.filter((entry) => entry.fromObjectId !== objectId && entry.toObjectId !== objectId),
      );
      setRemovingObjectId(null);
    } catch (deleteError) {
      setGraphError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setGraphSubmitting(false);
    }
  }

  function applySavedObjectTypeState(
    savedObjectType: PostgresObjectType,
    savedAttributeDefinitions: PostgresObjectAttributeDefinition[],
  ) {
    setObjectTypes((current) => {
      const next = current.some((entry) => entry.id === savedObjectType.id)
        ? current.map((entry) => (entry.id === savedObjectType.id ? savedObjectType : entry))
        : [...current, savedObjectType];
      return next.sort((left, right) => left.name.localeCompare(right.name));
    });
    setObjectAttributeDefinitions((current) =>
      [
        ...current.filter((definition) => definition.objectTypeId !== savedObjectType.id),
        ...savedAttributeDefinitions,
      ].sort((left, right) => {
        const objectTypeComparison = left.objectType.localeCompare(right.objectType);
        if (objectTypeComparison !== 0) return objectTypeComparison;
        if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
        return left.name.localeCompare(right.name);
      }),
    );
    setObjectTypeAttributeDrafts(
      savedAttributeDefinitions.map((definition) =>
        createTypeAttributeDraft({
          id: definition.id,
          name: definition.name,
          dataType: definition.dataType,
          description: definition.description,
          options: definition.options,
        })),
    );
    setObjectTypeAttributeModalDraft(null);
    setTypeAttributeModalError("");
    setObjects((current) =>
      current.map((entry) =>
        entry.objectTypeId === savedObjectType.id
          ? { ...entry, objectType: savedObjectType.name }
          : entry,
      ),
    );
    setRelationshipTypes((current) => {
      const objectTypeNameById = new Map(
        objectTypes
          .map((entry) => [entry.id, entry.name] as const)
          .filter((entry) => entry[0] !== savedObjectType.id),
      );
      objectTypeNameById.set(savedObjectType.id, savedObjectType.name);
      return current.map((entry) => ({
        ...entry,
        fromObjectTypes: entry.fromObjectTypeIds.map((id) => objectTypeNameById.get(id) ?? id),
        toObjectTypes: entry.toObjectTypeIds.map((id) => objectTypeNameById.get(id) ?? id),
      }));
    });
  }

  function applySavedRelationshipTypeState(
    savedRelationshipType: PostgresRelationshipType,
    savedAttributeDefinitions: PostgresRelationshipAttributeDefinition[],
  ) {
    setRelationshipTypes((current) => {
      const next = current.some((entry) => entry.id === savedRelationshipType.id)
        ? current.map((entry) => (entry.id === savedRelationshipType.id ? savedRelationshipType : entry))
        : [...current, savedRelationshipType];
      return next.sort((left, right) => left.name.localeCompare(right.name));
    });
    setRelationshipAttributeDefinitions((current) =>
      [
        ...current.filter((definition) => definition.relationshipTypeId !== savedRelationshipType.id),
        ...savedAttributeDefinitions,
      ].sort((left, right) => {
        const relationshipTypeComparison = left.relationshipType.localeCompare(right.relationshipType);
        if (relationshipTypeComparison !== 0) return relationshipTypeComparison;
        if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
        return left.name.localeCompare(right.name);
      }),
    );
    setRelationshipTypeAttributeDrafts(
      savedAttributeDefinitions.map((definition) =>
        createTypeAttributeDraft({
          id: definition.id,
          name: definition.name,
          dataType: definition.dataType,
          description: definition.description,
          options: definition.options,
        })),
    );
    setRelationshipTypeAttributeModalDraft(null);
    setTypeAttributeModalError("");
  }

  async function handleCreateRelationshipType(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextType = draftRelationshipTypeName.trim();
    setGraphError("");
    setGraphNotice("");
    if (!nextType) {
      setGraphError("Enter a relationship type name.");
      return;
    }

    const existingType = relationshipTypes.find((relationshipType) => relationshipType.name.toLowerCase() === nextType.toLowerCase());
    if (existingType) {
      setDraftRelationshipTypeName("");
      setDraftRelationshipLineShape("solid");
      setDraftRelationshipLineWeight(2);
      setDraftRelationshipArrowhead("one_sided");
      setDraftRelationshipColor(POSTGRES_RELATIONSHIP_DEFAULT_COLOR);
      setDraftRelationshipFromObjectTypeIds(allObjectTypeIds);
      setDraftRelationshipToObjectTypeIds(allObjectTypeIds);
      setDraftRelationshipFromSourceKinds(allSourceKindIds);
      setDraftRelationshipToSourceKinds(allSourceKindIds);
      initializeRelationshipTypeAttributeEditor(null);
      setCreateRelationshipTypeOpen(false);
      setRelationshipTypeId(existingType.id);
      setGraphNotice(`Switched to existing relationship type "${existingType.name}".`);
      return;
    }

    setGraphSubmitting(true);
    try {
      pendingLocalGraphRefreshSkipsRef.current = 1;
      const saved = await savePostgresRelationshipType({
        projectId: project.id,
        relationshipTypeId: null,
        name: nextType,
        description: "",
        lineShape: draftRelationshipLineShape,
        lineWeight: draftRelationshipLineWeight,
        arrowhead: draftRelationshipArrowhead,
        color: normalizePostgresRelationshipColor(draftRelationshipColor),
        fromObjectTypeIds: normalizePostgresRelationshipRestrictionSelection(draftRelationshipFromObjectTypeIds, allObjectTypeIds),
        toObjectTypeIds: normalizePostgresRelationshipRestrictionSelection(draftRelationshipToObjectTypeIds, allObjectTypeIds),
        fromSourceKinds: normalizePostgresRelationshipRestrictionSelection(draftRelationshipFromSourceKinds, allSourceKindIds),
        toSourceKinds: normalizePostgresRelationshipRestrictionSelection(draftRelationshipToSourceKinds, allSourceKindIds),
        attributes: relationshipTypeAttributeDrafts.map((draft) => ({
          id: draft.id || null,
          name: draft.name,
          dataType: draft.dataType,
          description: draft.description,
          options: draft.options,
        })),
      });
      applySavedRelationshipTypeState(saved.relationshipType, saved.attributeDefinitions);
      setDraftRelationshipTypeName("");
      setDraftRelationshipLineShape("solid");
      setDraftRelationshipLineWeight(2);
      setDraftRelationshipArrowhead("one_sided");
      setDraftRelationshipColor(POSTGRES_RELATIONSHIP_DEFAULT_COLOR);
      setDraftRelationshipFromObjectTypeIds(allObjectTypeIds);
      setDraftRelationshipToObjectTypeIds(allObjectTypeIds);
      setDraftRelationshipFromSourceKinds(allSourceKindIds);
      setDraftRelationshipToSourceKinds(allSourceKindIds);
      initializeRelationshipTypeAttributeEditor(null);
      setCreateRelationshipTypeOpen(false);
      setRelationshipTypeId(saved.relationshipType.id);
      setRelationshipAttributeValues({});
      setGraphNotice(`Created relationship type "${saved.relationshipType.name}".`);
    } catch (error) {
      pendingLocalGraphRefreshSkipsRef.current = 0;
      setGraphError(error instanceof Error ? error.message : String(error));
    } finally {
      setGraphSubmitting(false);
    }
  }

  async function handleSaveRelationshipType(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingRelationshipTypeModalId) return;
    const nextType = draftRelationshipTypeName.trim();
    setGraphError("");
    setGraphNotice("");
    if (!nextType) {
      setGraphError("Enter a relationship type name.");
      return;
    }

    setGraphSubmitting(true);
    try {
      pendingLocalGraphRefreshSkipsRef.current = 1;
      const saved = await savePostgresRelationshipType({
        projectId: project.id,
        relationshipTypeId: editingRelationshipTypeModalId,
        name: nextType,
        description: "",
        lineShape: draftRelationshipLineShape,
        lineWeight: draftRelationshipLineWeight,
        arrowhead: draftRelationshipArrowhead,
        color: normalizePostgresRelationshipColor(draftRelationshipColor),
        fromObjectTypeIds: normalizePostgresRelationshipRestrictionSelection(draftRelationshipFromObjectTypeIds, allObjectTypeIds),
        toObjectTypeIds: normalizePostgresRelationshipRestrictionSelection(draftRelationshipToObjectTypeIds, allObjectTypeIds),
        fromSourceKinds: normalizePostgresRelationshipRestrictionSelection(draftRelationshipFromSourceKinds, allSourceKindIds),
        toSourceKinds: normalizePostgresRelationshipRestrictionSelection(draftRelationshipToSourceKinds, allSourceKindIds),
        attributes: relationshipTypeAttributeDrafts.map((draft) => ({
          id: draft.id || null,
          name: draft.name,
          dataType: draft.dataType,
          description: draft.description,
          options: draft.options,
        })),
      });
      applySavedRelationshipTypeState(saved.relationshipType, saved.attributeDefinitions);
      setEditingRelationshipTypeModalId(null);
      setDraftRelationshipTypeName("");
      setDraftRelationshipLineShape("solid");
      setDraftRelationshipLineWeight(2);
      setDraftRelationshipArrowhead("one_sided");
      setDraftRelationshipColor(POSTGRES_RELATIONSHIP_DEFAULT_COLOR);
      setDraftRelationshipFromObjectTypeIds(allObjectTypeIds);
      setDraftRelationshipToObjectTypeIds(allObjectTypeIds);
      setDraftRelationshipFromSourceKinds(allSourceKindIds);
      setDraftRelationshipToSourceKinds(allSourceKindIds);
      initializeRelationshipTypeAttributeEditor(null);
      setGraphNotice(`Updated relationship type "${saved.relationshipType.name}".`);
    } catch (error) {
      pendingLocalGraphRefreshSkipsRef.current = 0;
      setGraphError(error instanceof Error ? error.message : String(error));
    } finally {
      setGraphSubmitting(false);
    }
  }

  async function handleDeleteRelationshipType(relationshipTypeId: string) {
    setGraphSubmitting(true);
    setGraphError("");
    setGraphNotice("");
    try {
      const relationshipTypeRecord = relationshipTypeById.get(relationshipTypeId);
      await deletePostgresRelationshipType(project.id, relationshipTypeId);
      await refreshGraph();
      setOpenRelationshipTypeActionsMenu(null);
      setRemovingRelationshipTypeId(null);
      setSelectedRelationshipTypeFilter((current) => (current === relationshipTypeId ? "all" : current));
      setRelationshipTypeId((current) => (current === relationshipTypeId ? "" : current));
      setCanvasRelationshipTypeId((current) => (current === relationshipTypeId ? "" : current));
      setGraphNotice(`Deleted relationship type "${relationshipTypeRecord?.name ?? "Untitled"}".`);
    } catch (error) {
      setGraphError(error instanceof Error ? error.message : String(error));
    } finally {
      setGraphSubmitting(false);
    }
  }

  async function handleCreateRelationship(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setGraphError("");
    setGraphNotice("");
    const fromEndpoint = parsePostgresRelationshipEndpointKey(fromObjectId);
    const toEndpoint = parsePostgresRelationshipEndpointKey(toObjectId);
    if (!fromEndpoint || !toEndpoint || !relationshipTypeId) {
      setGraphError("Choose two endpoints and a relationship type.");
      return;
    }

    setGraphSubmitting(true);
    try {
      pendingLocalGraphRefreshSkipsRef.current = 1;
      const created = await savePostgresRelationship({
        projectId: project.id,
        relationshipId: null,
        fromEntityType: fromEndpoint.entityType,
        fromEntityId: fromEndpoint.entityId,
        toEntityType: toEndpoint.entityType,
        toEntityId: toEndpoint.entityId,
        relationshipTypeId,
        description: relationshipDescription.trim(),
        lineShapeOverride: relationshipLineShapeOverride.trim() || null,
        lineWeightOverride: relationshipLineWeightOverride,
        arrowheadOverride: relationshipArrowheadOverride.trim() || null,
        colorOverride: normalizeOptionalPostgresRelationshipColor(relationshipColorOverride) || null,
        attributeValues: toRelationshipAttributePayload(relationshipAttributeDefinitionsForCreateType, relationshipAttributeValues),
      });
      setRelationships((current) => [...current, created]);
      setRelationshipDescription("");
      setRelationshipLineShapeOverride("");
      setRelationshipLineWeightOverride(null);
      setRelationshipArrowheadOverride("");
      setRelationshipColorOverride("");
      setRelationshipAttributeValues({});
      setCreateRelationshipOpen(false);
      setGraphNotice(`Created relationship "${created.relationshipType}".`);
    } catch (createError) {
      pendingLocalGraphRefreshSkipsRef.current = 0;
      setGraphError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setGraphSubmitting(false);
    }
  }

  async function handleSaveRelationship(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !editingRelationshipId
      || !editingRelationshipFromObjectId
      || !editingRelationshipToObjectId
      || !editingRelationshipTypeId
    ) {
      setGraphError("Choose two objects and a relationship type.");
      return;
    }

    setGraphSubmitting(true);
    setGraphError("");
    setGraphNotice("");
    try {
      pendingLocalGraphRefreshSkipsRef.current = 1;
      const updated = await savePostgresRelationship({
        projectId: project.id,
        relationshipId: editingRelationshipId,
        fromObjectId: editingRelationshipFromObjectId,
        toObjectId: editingRelationshipToObjectId,
        relationshipTypeId: editingRelationshipTypeId,
        description: editingRelationshipDescription.trim(),
        lineShapeOverride: editingRelationshipLineShapeOverride.trim() || null,
        lineWeightOverride: editingRelationshipLineWeightOverride,
        arrowheadOverride: editingRelationshipArrowheadOverride.trim() || null,
        colorOverride: normalizeOptionalPostgresRelationshipColor(editingRelationshipColorOverride) || null,
        attributeValues: toRelationshipAttributePayload(relationshipAttributeDefinitionsForEditingType, editingRelationshipAttributeValues),
      });
      setRelationships((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      setEditingRelationshipId(null);
      setEditingRelationshipLineShapeOverride("");
      setEditingRelationshipLineWeightOverride(null);
      setEditingRelationshipArrowheadOverride("");
      setEditingRelationshipColorOverride("");
      setEditingRelationshipAttributeValues({});
      setGraphNotice(`Updated relationship "${updated.relationshipType}".`);
    } catch (updateError) {
      pendingLocalGraphRefreshSkipsRef.current = 0;
      setGraphError(updateError instanceof Error ? updateError.message : String(updateError));
    } finally {
      setGraphSubmitting(false);
    }
  }

  async function handleDeleteRelationship(relationshipId: string) {
    setGraphSubmitting(true);
    setGraphError("");
    setGraphNotice("");
    try {
      await deletePostgresRelationship(project.id, relationshipId);
      setRelationships((current) => current.filter((entry) => entry.id !== relationshipId));
      setRemovingRelationshipId(null);
      setGraphNotice("Deleted relationship.");
    } catch (deleteError) {
      setGraphError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setGraphSubmitting(false);
    }
  }

  return (
    <div className="app-shell">
      <PostgresSidebar
        activeScreen={activeScreen}
        activeProject={project}
        authSession={authSession}
        onShowProjects={onBack}
        onShowProjectHome={() => setActiveScreen("home")}
        onShowProjectUsers={() => setActiveScreen("users")}
        onShowProjectSources={() => setActiveScreen("sources")}
        onShowProjectAnnotations={() => setActiveScreen("annotations")}
        onShowProjectCodebook={() => setActiveScreen("codebook")}
        onShowProjectCodeText={() => setActiveScreen("code-text")}
        onShowProjectMemos={() => setActiveScreen("memos")}
        onShowProjectReports={() => setActiveScreen("reports")}
        onShowProjectLog={() => setActiveScreen("project-log")}
        onShowProjectObjects={() => setActiveScreen("objects")}
        onShowProjectRelationships={() => setActiveScreen("relationships")}
        onShowAiAssistHome={() => setActiveScreen("ai-assist")}
        onShowAiAssistChat={() => setActiveScreen("ai-assist-chat")}
        onShowAiAssistedCoding={() => setActiveScreen("ai-assisted-coding")}
        onShowAiAnalyze={() => setActiveScreen("ai-analyze")}
        onShowAiAssistSourceAttributes={() => setActiveScreen("ai-assist-source-attributes")}
        onShowAiAssistProcessDocuments={() => setActiveScreen("ai-assist-process-documents")}
        onShowFreeDraw={() => {
          clearSavedCanvasSession();
          setActiveScreen("free-draw");
        }}
        onShowExplore={() => {
          clearSavedCanvasSession();
          setActiveScreen("explore");
        }}
        onShowConstruct={() => {
          clearSavedCanvasSession();
          setActiveScreen("construct");
        }}
        onShowCanvasView={() => setActiveScreen("view")}
        onShowAppSettings={() => setActiveScreen("app-settings")}
        onShowProjectSettings={() => setActiveScreen("project-settings")}
        onShowUserSettings={() => setActiveScreen("user-settings")}
        onBackToGate={onBack}
        onSignOut={onSignOut}
      />
      <main className="app-main">
        <div className="view">
          {activeScreen === "home" ? (
            <div className="home-view postgres-experiment-home-view" style={{ minHeight: "100%" }}>
              <div className="home-dashboard postgres-experiment-home-dashboard">
              <div className="home-primary-column postgres-experiment-home-primary-column">
                <section className="home-project-card" aria-label="Project title">
                  <div className="home-project-card-header">
                    <h2>Project Title</h2>
                  </div>
                  <p className="home-project-title-value">{project.name || "Untitled project"}</p>
                </section>

                <section className="home-project-card" aria-label="Project description">
                  <div className="home-project-card-header">
                    <h2>Project Description</h2>
                  </div>
                  {project.description.trim() ? (
                    <p className="home-project-description">{project.description}</p>
                  ) : (
                    <p className="home-project-description home-project-description--empty">
                      No project description has been added yet.
                    </p>
                  )}
                </section>

                <section className="home-project-card" aria-label="Project information">
                  <div className="home-project-card-header">
                    <h2>Project Information</h2>
                  </div>
                  <div className="home-restricted-list">
                    <div className="home-restricted-item">
                      <span className="home-restricted-label">Your access</span>
                      <span className="home-restricted-value">
                        {isProjectAdmin ? "administrator" : (currentProjectUser?.role ?? "member")}
                      </span>
                    </div>
                    <div className="home-restricted-item">
                      <span className="home-restricted-label">Created</span>
                      <span className="home-restricted-value">{formatPostgresDateTime(project.createdAt)}</span>
                    </div>
                    <div className="home-restricted-item">
                      <span className="home-restricted-label">Last updated</span>
                      <span className="home-restricted-value">{formatPostgresDateTime(lastProjectActivityAt)}</span>
                    </div>
                  </div>
                </section>
              </div>

              <div className="home-stats-grid postgres-experiment-home-stats-grid">
                <PostgresStatCard
                  title="Users"
                  count={users.length}
                  stats={[
                    { label: "Owners", value: users.filter((user) => user.role === "owner").length },
                    { label: "Editors", value: users.filter((user) => user.role === "editor").length },
                    { label: "Coders", value: users.filter((user) => user.role === "coder").length },
                    { label: "Viewers", value: users.filter((user) => user.role === "viewer").length },
                  ]}
                  onClick={() => setActiveScreen("users")}
                />

                <PostgresStatCard
                  title="Objects"
                  count={objects.length}
                  stats={[
                    { label: "Types", value: objectTypeSummaries.length },
                    { label: "Attributes", value: objectAttributeDefinitions.length },
                    { label: "Described", value: objects.filter((object) => object.description.trim()).length },
                  ]}
                  onClick={() => setActiveScreen("objects")}
                />

                <PostgresStatCard
                  title="Relationships"
                  count={relationships.length}
                  stats={[
                    { label: "Attribute sets", value: relationshipAttributeDefinitions.length },
                    { label: "Typed links", value: new Set(relationships.map((relationship) => relationship.relationshipType.trim()).filter(Boolean)).size },
                    { label: "Described", value: relationships.filter((relationship) => relationship.description.trim()).length },
                  ]}
                  onClick={() => setActiveScreen("relationships")}
                />
              </div>
            </div>
            </div>
          ) : activeScreen === "users" ? (
            <>
              <div className="view users-view postgres-users-view">
                <header className="view-header">
                  <div className="users-title-wrap">
                    <h1>Project Users</h1>
                  </div>
                  <div className="view-header-actions">
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={!canInviteUsers || availableAppUsers.length === 0}
                      onClick={() => setAddUserOpen(true)}
                      title={!canInviteUsers ? "Only project owners, administrators, and editors can add users." : undefined}
                    >
                      Add user
                    </button>
                  </div>
                </header>

                <div className="users-content postgres-users-content" style={{ alignItems: "stretch" }}>
                  {userNotice ? <p className="settings-success">{userNotice}</p> : null}
                  {usersError ? <p className="users-error">{usersError}</p> : null}

                  <div
                    className="postgres-sources-grid project-users-grid"
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
                            <h2 style={{ margin: 0, fontSize: 18 }}>User roles</h2>
                            <span className="home-restricted-value">{users.length}</span>
                          </div>
                        </div>
                        <div>
                          <table className="users-table" style={{ tableLayout: "fixed" }}>
                            <tbody>
                              <tr
                                className="users-row"
                                style={{
                                  background: selectedUserRoleFilter === "all" ? "rgba(53, 80, 112, 0.10)" : undefined,
                                }}
                              >
                                <td
                                  className="users-td users-td--name"
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => setSelectedUserRoleFilter("all")}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      event.preventDefault();
                                      setSelectedUserRoleFilter("all");
                                    }
                                  }}
                                >
                                  All
                                </td>
                                <td className="users-td users-td--muted">{users.length}</td>
                              </tr>
                              {userRoleSummaries.map((summary) => (
                                <tr
                                  key={summary.role}
                                  className="users-row"
                                  style={{
                                    background: selectedUserRoleFilter === summary.role ? "rgba(53, 80, 112, 0.10)" : undefined,
                                  }}
                                >
                                  <td
                                    className="users-td users-td--name"
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => setSelectedUserRoleFilter(summary.role)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        setSelectedUserRoleFilter(summary.role);
                                      }
                                    }}
                                  >
                                    <div style={{ paddingLeft: 18 }}>{summary.label}</div>
                                  </td>
                                  <td className="users-td users-td--muted">{summary.count}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
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
                      {usersLoading ? (
                        <div className="empty-state postgres-users-empty-state">
                          <p>Loading PostgreSQL project users...</p>
                        </div>
                      ) : users.length === 0 ? (
                        <div className="empty-state postgres-users-empty-state">
                          <p>No users have been added to this PostgreSQL project yet.</p>
                        </div>
                      ) : filteredProjectUsers.length === 0 ? (
                        <div className="empty-state postgres-users-empty-state">
                          <p>No users match this role.</p>
                        </div>
                      ) : (
                        <div className="users-table-wrap postgres-users-table-wrap" style={{ maxHeight: 520 }}>
                          <table className="users-table">
                            <thead>
                              <tr>
                                <th className="users-th" style={{ width: "26%" }}>User</th>
                                <th className="users-th" style={{ width: "28%" }}>Email</th>
                                <th className="users-th" style={{ width: "12%" }}>Role</th>
                                <th className="users-th" style={{ width: "17%" }}>Created</th>
                                <th className="users-th" style={{ width: "17%" }}>Updated</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredProjectUsers.map((user) => (
                                <tr
                                  key={user.id}
                                  className={`users-row project-users-row${canChangeRoles ? "" : " users-row--disabled"}`}
                                  onClick={() => {
                                    if (canChangeRoles) {
                                      setEditingUserId(user.id);
                                      setEditRole(user.role as (typeof PROJECT_ROLE_OPTIONS)[number]);
                                      setRemovingUserId(null);
                                    }
                                  }}
                                >
                                  <td className="users-td users-td--name">
                                    <div className="postgres-users-name-cell">
                                      <span>{user.name}</span>
                                      <span className="postgres-users-meta">
                                        {user.role === "owner" ? "Project owner" : "Project member"}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="users-td users-td--muted">{user.email}</td>
                                  <td className="users-td">
                                    <span className={`role-badge role-badge--${user.role}`}>
                                      {projectRoleLabel(user.role)}
                                    </span>
                                  </td>
                                  <td className="users-td users-td--muted">{formatCurrentDateTime(user.createdAt)}</td>
                                  <td className="users-td users-td--muted">{formatCurrentDateTime(user.updatedAt)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  </div>
                </div>
              </div>

              {addUserOpen ? (
                <div className="modal-overlay" onClick={() => !usersSubmitting && setAddUserOpen(false)}>
                  <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
                    <h2>Add user</h2>
                    <p className="users-guide-copy" style={{ marginBottom: 16 }}>
                      Add an existing Kanqual account to this PostgreSQL project and choose what that user can do here.
                    </p>
                    <form onSubmit={handleCreateUser} className="form">
                      <label className="form-label">
                        Registered user
                        <select
                          className="form-input"
                          value={selectedAppUserId}
                          onChange={(event) => setSelectedAppUserId(event.target.value)}
                          autoFocus
                        >
                          <option value="">Select a registered user</option>
                          {availableAppUsers.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.name} ({user.email})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="form-label">
                        Role
                        <select
                          className="form-input"
                          value={userRole}
                          onChange={(event) => setUserRole(event.target.value as (typeof PROJECT_ROLE_OPTIONS)[number])}
                        >
                          {inviteRoles.map((role) => (
                            <option key={role} value={role}>
                              {projectRoleLabel(role)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="form-actions">
                        <button type="button" className="btn" onClick={() => setAddUserOpen(false)} disabled={usersSubmitting}>
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="btn btn--primary"
                          disabled={usersSubmitting || !selectedAppUserId}
                        >
                          {usersSubmitting ? "Adding..." : "Add user"}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              ) : null}

              {editingUserId ? (
                (() => {
                  const user = users.find((entry) => entry.id === editingUserId);
                  if (!user) return null;
                  return (
                    <div className="modal-overlay" onClick={() => !usersSubmitting && setEditingUserId(null)}>
                      <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
                        <h2>Edit user</h2>
                        <p className="auth-hint" style={{ marginTop: 0 }}>
                          {user.name} ({user.email})
                        </p>
                        <div className="form">
                          <label className="form-label">
                            Project role
                            <select
                              className="form-input"
                              value={editRole}
                              onChange={(event) => setEditRole(event.target.value as (typeof PROJECT_ROLE_OPTIONS)[number])}
                            >
                              {getEditableRolesForUser(user).map((role) => (
                                <option key={role} value={role}>
                                  {projectRoleLabel(role)}
                                </option>
                              ))}
                            </select>
                          </label>
                          {user.role === "owner" && ownerCount <= 1 ? (
                            <p className="auth-hint" style={{ marginTop: 0 }}>
                              A project must always have at least one owner.
                            </p>
                          ) : null}
                          <div className="form-actions">
                            <button type="button" className="btn" onClick={() => setEditingUserId(null)} disabled={usersSubmitting}>
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="btn btn--danger"
                              disabled={!!getRemoveBlockReason(user)}
                              onClick={() => {
                                setRemovingUserId(user.id);
                                setEditingUserId(null);
                              }}
                            >
                              Remove
                            </button>
                            <button
                              type="button"
                              className="btn btn--primary"
                              onClick={() => void handleSaveUserRole(user)}
                              disabled={usersSubmitting || editRole === user.role}
                            >
                              {usersSubmitting ? "Saving..." : "Save role"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()
              ) : null}

              {removingUserId ? (
                (() => {
                  const user = users.find((entry) => entry.id === removingUserId);
                  if (!user) return null;
                  return (
                    <div className="modal-overlay" onClick={() => !usersSubmitting && setRemovingUserId(null)}>
                      <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
                        <h2>Remove user</h2>
                        <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                          Remove {user.name} from this project?
                        </p>
                        <p className="modal-warning-text">
                          Removing this user revokes access to this project but does not delete their Kanqual account.
                        </p>
                        <div className="form-actions" style={{ marginTop: 24 }}>
                          <button type="button" className="btn" onClick={() => setRemovingUserId(null)} disabled={usersSubmitting}>
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="btn btn--danger"
                            onClick={() => void handleRemoveUser(user)}
                            disabled={usersSubmitting}
                          >
                            {usersSubmitting ? "Removing..." : "Remove from project"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()
              ) : null}
            </>
          ) : activeScreen === "sources" ? (
            <Suspense fallback={<ViewLoadingFallback />}>
              <PostgresProjectSourcesViewLazy
                projectId={project.id}
                currentUserId={authSession.user.id}
                canManageSources={canManageSources}
                canKickSourceLocks={canManageSources}
                canManageAnnotations={canManageAnnotations}
                canManageMemos={canManageMemos}
                canCreateCodes={canManageAnnotations}
                initialSourceId={postgresSourceNavigationTarget?.sourceId ?? null}
                initialAnnotationId={postgresSourceNavigationTarget?.annotationId ?? null}
                initialTextSegment={null}
                onInitialNavigationHandled={() => setPostgresSourceNavigationTarget(null)}
                onOpenPostgresMemoDraft={(payload) => {
                  setPostgresMemoDraftTarget(payload);
                  setActiveScreen("memos");
                }}
              />
            </Suspense>
          ) : activeScreen === "code-text" ? (
            <Suspense fallback={<ViewLoadingFallback />}>
              <PostgresAnalysisCodeSourcesViewLazy
                projectId={project.id}
                currentUserId={authSession.user.id}
                canManageSources={canManageSources}
                canKickSourceLocks={canManageSources}
                canManageAnnotations={canManageAnnotations}
                canManageMemos={canManageMemos}
                canCreateCodes={canManageAnnotations}
                initialSourceId={postgresSourceNavigationTarget?.sourceId ?? null}
                initialAnnotationId={postgresSourceNavigationTarget?.annotationId ?? null}
                initialTextSegment={postgresSourceNavigationTarget?.textSegment ?? null}
                onInitialNavigationHandled={() => setPostgresSourceNavigationTarget(null)}
                onOpenPostgresMemoDraft={(payload) => {
                  setPostgresMemoDraftTarget(payload);
                  setActiveScreen("memos");
                }}
              />
            </Suspense>
          ) : activeScreen === "annotations" ? (
            <Suspense fallback={<ViewLoadingFallback />}>
              <AnnotationsViewLazy
                postgresProjectId={project.id}
                postgresProjectStoragePath={project.storagePath}
                postgresCurrentUserId={authSession.user.id}
                initialPostgresAnnotationId={postgresAnnotationNavigationTargetId}
                onInitialPostgresAnnotationHandled={() => setPostgresAnnotationNavigationTargetId(null)}
                onOpenPostgresSourceAnnotation={({ sourceId, annotationId }) => {
                  setPostgresSourceNavigationTarget({
                    sourceId,
                    annotationId,
                    textSegment: null,
                  });
                  setActiveScreen("code-text");
                }}
              />
            </Suspense>
          ) : activeScreen === "codebook" ? (
            <Suspense fallback={<ViewLoadingFallback />}>
              <CodebookViewLazy
                postgresProjectId={project.id}
                postgresProjectStoragePath={project.storagePath}
                postgresCanCreateCodes={canManageAnnotations}
                postgresCanEditCodes={canManageAnnotations}
                postgresCanDeleteCodes={canManageAnnotations}
                postgresCanMemoAboutCodes={canManageMemos}
                onOpenPostgresSourceAnnotation={({ sourceId, annotationId }: { sourceId: string; annotationId: string }) => {
                  setPostgresSourceNavigationTarget({
                    sourceId,
                    annotationId,
                    textSegment: null,
                  });
                  setActiveScreen("sources");
                }}
                onOpenPostgresMemoForCode={({ codeId }: { codeId: string }) => {
                  setPostgresMemoDraftTarget({
                    codeIds: [codeId],
                  });
                  setActiveScreen("memos");
                }}
              />
            </Suspense>
          ) : activeScreen === "memos" ? (
            <Suspense fallback={<ViewLoadingFallback />}>
              <PostgresProjectMemosViewLazy
                projectId={project.id}
                projectStoragePath={project.storagePath}
                canManageMemos={canManageMemos}
                draftTarget={postgresMemoDraftTarget}
                onDraftHandled={() => setPostgresMemoDraftTarget(null)}
              />
            </Suspense>
          ) : activeScreen === "reports" ? (
            <Suspense fallback={<ViewLoadingFallback />}>
              <PostgresReportsViewLazy projectId={project.id} projectStoragePath={project.storagePath} />
            </Suspense>
          ) : activeScreen === "project-log" ? (
            <Suspense fallback={<ViewLoadingFallback />}>
              <PostgresProjectLogViewLazy
                projectId={project.id}
              />
            </Suspense>
          ) : activeScreen === "ai-assist" ? (
            <Suspense fallback={<ViewLoadingFallback />}>
              <PostgresAiAssistHomeViewLazy
                project={project}
                authSession={authSession}
                canManageProject={canManageProjectSettings}
                canManageEmbeddings={canManageSources}
              />
            </Suspense>
          ) : activeScreen === "ai-assist-chat" ? (
            <Suspense fallback={<ViewLoadingFallback />}>
              <PostgresAiAssistChatViewLazy
                project={project}
                currentProjectUser={currentProjectUser}
                isProjectAdmin={isProjectAdmin}
                onNavigate={(screen, target) => {
                  if (screen === "sources" && target?.sourceId) {
                    setPostgresSourceNavigationTarget({
                      sourceId: target.sourceId,
                      annotationId: target.annotationId ?? null,
                      textSegment: null,
                    });
                  }
                  if (screen === "code-text" && target?.sourceId) {
                    setPostgresSourceNavigationTarget({
                      sourceId: target.sourceId,
                      annotationId: target.annotationId ?? null,
                      textSegment:
                        typeof target.startOffset === "number"
                        && typeof target.endOffset === "number"
                        && target.endOffset > target.startOffset
                          ? { startOffset: target.startOffset, endOffset: target.endOffset }
                          : null,
                    });
                  }
                  if (screen === "annotations" && target?.annotationId) {
                    setPostgresAnnotationNavigationTargetId(target.annotationId);
                  }
                  if (screen === "objects" && target?.objectId) {
                    setSelectedObjectTypeFilter("all");
                    setSelectedObjectDetailsId(target.objectId);
                  }
                  if (screen === "relationships" && target?.relationshipId) {
                    const relationship = relationships.find((entry) => entry.id === target.relationshipId);
                    setSelectedRelationshipTypeFilter(relationship?.relationshipTypeId ?? "all");
                    setSelectedRelationshipDetailsId(target.relationshipId);
                  }
                  setActiveScreen(screen);
                }}
              />
            </Suspense>
          ) : activeScreen === "ai-assisted-coding" ? (
            <Suspense fallback={<ViewLoadingFallback />}>
              <PostgresAiAssistAssistedCodingViewLazy
                projectId={project.id}
                currentUserId={authSession.user.id}
                canManageSources={canManageSources}
                canKickSourceLocks={canManageSources}
                canManageAnnotations={canManageAnnotations}
                canManageMemos={canManageMemos}
                canCreateCodes={canManageAnnotations}
                initialSourceId={postgresSourceNavigationTarget?.sourceId ?? null}
                initialAnnotationId={postgresSourceNavigationTarget?.annotationId ?? null}
                initialTextSegment={postgresSourceNavigationTarget?.textSegment ?? null}
                onInitialNavigationHandled={() => setPostgresSourceNavigationTarget(null)}
                onOpenPostgresMemoDraft={(payload) => {
                  setPostgresMemoDraftTarget(payload);
                  setActiveScreen("memos");
                }}
              />
            </Suspense>
          ) : activeScreen === "ai-analyze" ? (
            <Suspense fallback={<ViewLoadingFallback />}>
              <PostgresAiAssistAnalyzeViewLazy
                projectId={project.id}
                canUseAiAnalyzeTools={canManageAnnotations}
                onOpenAnnotation={(target) => {
                  setPostgresSourceNavigationTarget({
                    sourceId: target.sourceId,
                    annotationId: target.annotationId,
                    textSegment: null,
                  });
                  setActiveScreen("code-text");
                }}
              />
            </Suspense>
          ) : activeScreen === "ai-assist-source-attributes" ? (
            <Suspense fallback={<ViewLoadingFallback />}>
              <PostgresAiAssistAttributesViewLazy
                projectId={project.id}
                canUseAiAttributeTools={canManageAnnotations}
              />
            </Suspense>
          ) : activeScreen === "ai-assist-object-attributes" ? (
            <PostgresAiAssistPortPlaceholderView
              title="Object Attributes"
              detail="AI attribute suggestions for PostgreSQL objects will mount here."
            />
          ) : activeScreen === "ai-assist-process-documents" ? (
            <Suspense fallback={<ViewLoadingFallback />}>
              <PostgresAiAssistProcessSourcesViewLazy
                projectId={project.id}
                canUseAiProcessDocuments={canManageSources}
                canReviewProcessedDocuments={canManageAnnotations}
              />
            </Suspense>
          ) : activeScreen === "objects" && selectedObjectDetails ? (
            <>
              <div className="view users-view">
                {graphNotice ? <p className="settings-success">{graphNotice}</p> : null}
                {graphError ? <p className="auth-error">{graphError}</p> : null}
                <div className="view doc-detail-view" style={{ padding: 0 }}>
                  <div className="workspace-back-row workspace-back-row--split">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setSelectedObjectDetailsId(null)}
                    >
                      Back
                    </button>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => openEditObjectModal(selectedObjectDetails)}
                      >
                        Edit Object
                      </button>
                      <button
                        type="button"
                        className="btn btn--danger"
                        onClick={() => setRemovingObjectId(selectedObjectDetails.id)}
                      >
                        Delete Object
                      </button>
                    </div>
                  </div>

                  <div className="doc-detail-layout">
                    <div className="doc-detail-left">
                      <div className="case-card">
                        <h3 className="case-card-title">Graphics</h3>
                        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
                          <ObjectShapeSwatch
                            shape={resolvePostgresObjectShape(selectedObjectDetails, selectedObjectDetailsType)}
                            fill={resolvePostgresObjectFill(selectedObjectDetails, selectedObjectDetailsType)}
                            color={resolvePostgresObjectColor(selectedObjectDetails, selectedObjectDetailsType)}
                            sourceVisualKey={getPostgresSourceObjectVisualKey(selectedObjectDetailsType?.systemKey)}
                            imageStoragePath={selectedObjectDetails.imageStoragePath || selectedObjectDetailsType?.imageStoragePath || ""}
                            projectStoragePath={project.storagePath}
                            width={48}
                            minHeight={40}
                          />
                          <p className="case-card-value" style={{ margin: 0 }}>
                            {selectedObjectDetails.objectType || "Object"}
                          </p>
                        </div>
                        <dl className="user-detail-meta case-detail-meta">
                          <dt>Color</dt>
                          <dd>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                              <span
                                aria-hidden="true"
                                style={{
                                  width: 18,
                                  height: 18,
                                  borderRadius: 6,
                                  border: "1px solid rgba(53, 80, 112, 0.18)",
                                  background: resolvePostgresObjectColor(selectedObjectDetails, selectedObjectDetailsType),
                                }}
                              />
                              {selectedObjectDetails.colorOverride?.trim() || "Inherited"}
                            </span>
                          </dd>
                          <dt>Shape</dt>
                          <dd>
                            {selectedObjectDetails.shapeOverride?.trim()
                              ? formatPostgresObjectShapeLabel(resolvePostgresObjectShape(selectedObjectDetails, selectedObjectDetailsType))
                              : "Inherited"}
                          </dd>
                          <dt>Fill</dt>
                          <dd>
                            {selectedObjectDetails.fillOverride?.trim()
                              ? formatPostgresObjectFillLabel(resolvePostgresObjectFill(selectedObjectDetails, selectedObjectDetailsType))
                              : "Inherited"}
                          </dd>
                        </dl>
                      </div>

                      <div className="case-card">
                        <h3 className="case-card-title">Attributes</h3>
                        {selectedObjectDetailsAttributeDefinitions.length > 0 ? (
                          <div className="case-detail-attributes-table-wrap">
                            <table className="case-detail-attributes-table">
                              <thead>
                                <tr>
                                  <th className="case-detail-attributes-label" scope="col">Attribute</th>
                                  <th className="case-detail-attributes-value" scope="col">Value</th>
                                </tr>
                              </thead>
                              <tbody>
                                {selectedObjectDetailsAttributeDefinitions.map((definition) => {
                                  const rawValue = selectedObjectDetails.attributeValues.find(
                                    (value) => value.attributeDefinitionId === definition.id,
                                  )?.value ?? "";
                                  return (
                                    <tr key={definition.id}>
                                      <th className="case-detail-attributes-label" scope="row">{definition.name}</th>
                                      <td className="case-detail-attributes-value">
                                        <button
                                          type="button"
                                          className="case-detail-attribute-value-button"
                                          onClick={() => setDetailAttributeHistoryTarget({
                                            projectId: project.id,
                                            ownerKind: "object",
                                            ownerId: selectedObjectDetails.id,
                                            ownerName: selectedObjectDetails.title || "Untitled object",
                                            attributeDefinitionId: definition.id,
                                            attributeName: definition.name,
                                          })}
                                          title="View attribute value history"
                                        >
                                          {rawValue ? formatPostgresAttributeDisplay(rawValue, definition.dataType) : "-"}
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="case-card-empty">No shared attributes for this object type yet.</p>
                        )}
                      </div>
                    </div>

                    <div className="doc-detail-right doc-detail-right--annotation">
                      <div className="case-card">
                        <h3 className="case-card-title">Details</h3>
                        <p className="case-card-value">{selectedObjectDetails.title || "Untitled object"}</p>
                        <dl className="user-detail-meta case-detail-meta" style={{ marginTop: 16 }}>
                          <dt>Object type</dt> <dd>{selectedObjectDetails.objectType || "-"}</dd>
                          <dt>Created</dt>
                          <dd>
                            {formatCurrentDateTime(selectedObjectDetails.createdAt, {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })}
                          </dd>
                          <dt>Updated</dt>
                          <dd>
                            {formatCurrentDateTime(selectedObjectDetails.updatedAt, {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })}
                          </dd>
                        </dl>
                        <div style={{ marginTop: 18 }}>
                          <h3 className="case-card-title">Description</h3>
                          {selectedObjectDetails.description.trim() ? (
                            <p style={{ margin: 0, lineHeight: 1.6, overflowWrap: "anywhere" }}>
                              {selectedObjectDetails.description}
                            </p>
                          ) : (
                            <p className="case-card-empty">No description yet.</p>
                          )}
                        </div>
                      </div>

                      <div className="case-card" style={{ marginTop: 16 }}>
                        <h3 className="case-card-title">Relationships</h3>
                        {selectedObjectRelationshipRows.length > 0 ? (
                          <div className="case-detail-attributes-table-wrap">
                            <table className="users-table" style={{ tableLayout: "fixed" }}>
                              <thead>
                                <tr>
                                  <th className="users-th" style={{ width: "42%" }}>Other object</th>
                                  <th className="users-th" style={{ width: "24%" }}>Object type</th>
                                  <th className="users-th" style={{ width: "34%" }}>Relationship</th>
                                </tr>
                              </thead>
                              <tbody>
                                {selectedObjectRelationshipRows.map((row) => (
                                  <tr key={row.id} className="users-row">
                                    <td className="users-td users-td--name">
                                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                                        <ObjectShapeSwatch
                                          shape={row.otherObjectShape}
                                          fill={row.otherObjectFill}
                                          color={row.otherObjectColor}
                                          sourceVisualKey={row.otherObjectSourceVisualKey}
                                          imageStoragePath={row.otherObjectImageStoragePath}
                                          projectStoragePath={project.storagePath}
                                          width={24}
                                          minHeight={18}
                                        />
                                        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                          {row.otherObjectName}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="users-td users-td--muted">{row.otherObjectType}</td>
                                    <td className="users-td users-td--muted">
                                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                                        <RelationshipTypeLinePreview
                                          lineShape={row.relationshipLineShape}
                                          lineWeight={row.relationshipLineWeight}
                                          arrowhead={row.relationshipArrowhead}
                                          color={row.relationshipColor}
                                        />
                                        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                          {row.relationshipName}
                                        </span>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="case-card-empty">No relationships for this object yet.</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                {removingObjectId ? (
                  (() => {
                    const object = objects.find((entry) => entry.id === removingObjectId);
                    if (!object) return null;
                    return (
                      <div className="modal-overlay" onClick={() => !graphSubmitting && setRemovingObjectId(null)}>
                        <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
                          <h2>Delete object</h2>
                          <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                            Delete <strong>{object.title}</strong>?
                          </p>
                          <p className="modal-warning-text">
                            This permanently removes the object and any relationships connected to it.
                          </p>
                          <div className="form-actions" style={{ marginTop: 24 }}>
                            <button type="button" className="btn" onClick={() => setRemovingObjectId(null)} disabled={graphSubmitting}>
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="btn btn--danger"
                              onClick={() => void handleDeleteObject(object.id)}
                              disabled={graphSubmitting}
                            >
                              {graphSubmitting ? "Deleting..." : "Delete object"}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()
                ) : null}
                {detailAttributeHistoryTarget ? (
                  <PostgresAttributeValueHistoryModal
                    target={detailAttributeHistoryTarget}
                    onClose={() => setDetailAttributeHistoryTarget(null)}
                  />
                ) : null}
              </div>
            </>
          ) : activeScreen === "objects" ? (
            <>
              <div className="view users-view">
                <header className="view-header">
                  <div className="users-title-wrap">
                    <h1>Research Objects</h1>
                  </div>
                  <div className="view-header-actions">
                    {showObjectAttributesTable && selectedObjectTypeFilter !== "all" ? (
                      <button
                        type="button"
                        className="btn btn--primary"
                        onClick={openObjectWorkspaceAttributeModal}
                        disabled={graphSubmitting || objectWorkspaceAttributeTypeOptions.length === 0}
                      >
                        Add Attribute
                      </button>
                    ) : !showObjectAttributesTable ? (
                      <>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => {
                            setEditingObjectTypeModalId(null);
                            setDraftObjectTypeName("");
                            setDraftObjectTypeDescription("");
                            setDraftObjectTypeShape("rounded");
                            setDraftObjectTypeColor(POSTGRES_OBJECT_TYPE_DEFAULT_COLOR);
                            setDraftObjectTypeFill("filled");
                            setDraftObjectTypeImageStoragePath("");
                            setDraftObjectTypePendingImage(null);
                            setDraftObjectTypeGraphicMode("select");
                            initializeObjectTypeAttributeEditor(null);
                            setObjectTypeModalTab("details");
                            setGraphError("");
                            setCreateObjectTypeOpen(true);
                          }}
                        >
                          Add object type
                        </button>
                        <button
                          type="button"
                          className="btn btn--primary"
                          onClick={() => openCreateObjectModal()}
                        >
                          New object
                        </button>
                      </>
                    ) : null}
                  </div>
                </header>

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
                      justifyContent: "center",
                      gap: 16,
                      minHeight: 0,
                      maxHeight: "100%",
                      overflowY: "auto",
                      overflowX: "hidden",
                      paddingRight: 4,
                    }}
                  >
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
                    <section
                      className="home-project-card"
                      style={{
                        padding: 0,
                        overflow: "hidden",
                      }}
                    >
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
                          <h2 style={{ margin: 0, fontSize: 18 }}>Object types</h2>
                          <span className="home-restricted-value">{objectTypeSummaries.length}</span>
                        </div>
                      </div>

                      <div>
                        <table className="users-table" style={{ tableLayout: "fixed" }}>
                          <thead>
                            <tr>
                              <th
                                className={`users-th${objectTypeSortCol === "objectType" ? " users-th--sorted" : ""}`}
                                style={{ width: "76%" }}
                                onClick={() => handleObjectTypeSort("objectType")}
                              >
                                Type
                                <span className="users-sort-icon">
                                  {objectTypeSortCol === "objectType" ? (objectTypeSortDir === "asc" ? " ↑" : " ↓") : " ↕"}
                                </span>
                              </th>
                              <th
                                className={`users-th${objectTypeSortCol === "count" ? " users-th--sorted" : ""}`}
                                style={{ width: "24%" }}
                                onClick={() => handleObjectTypeSort("count")}
                              >
                                Count
                                <span className="users-sort-icon">
                                  {objectTypeSortCol === "count" ? (objectTypeSortDir === "asc" ? " ↑" : " ↓") : " ↕"}
                                </span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr
                              className="users-row"
                              style={{
                                background: selectedObjectTypeFilter === "all" ? "rgba(53, 80, 112, 0.10)" : undefined,
                              }}
                            >
                              <td
                                className="users-td users-td--name"
                                role="button"
                                tabIndex={0}
                                onClick={() => setSelectedObjectTypeFilter("all")}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    setSelectedObjectTypeFilter("all");
                                  }
                                }}
                              >
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  <span>All objects</span>
                                  <span className="postgres-users-meta">Across every object type</span>
                                </div>
                              </td>
                              <td className="users-td users-td--muted">{customObjects.length}</td>
                            </tr>
                            {objectTypeSummaries.map((summary) => (
                              <tr
                                key={summary.objectTypeId}
                                className="users-row"
                                onContextMenu={(event) => {
                                  event.preventDefault();
                                  setOpenObjectActionsMenu(null);
                                  setOpenObjectTypeActionsMenu({
                                    id: summary.objectTypeId,
                                    left: Math.min(event.clientX, window.innerWidth - 168),
                                    top: Math.min(event.clientY, window.innerHeight - 96),
                                  });
                                }}
                                style={{
                                  background: selectedObjectTypeFilter === summary.objectTypeId ? "rgba(53, 80, 112, 0.10)" : undefined,
                                }}
                              >
                                <td
                                  className="users-td users-td--name"
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => setSelectedObjectTypeFilter(summary.objectTypeId)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      event.preventDefault();
                                      setSelectedObjectTypeFilter(summary.objectTypeId);
                                    }
                                  }}
                                >
                                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                    <ObjectShapeSwatch
                                      shape={normalizePostgresObjectTypeShape(summary.shape)}
                                      fill={normalizePostgresObjectFill(summary.fill)}
                                      color={normalizePostgresObjectTypeColor(summary.color)}
                                      sourceVisualKey={getPostgresSourceObjectVisualKey(summary.systemKey)}
                                      imageStoragePath={summary.imageStoragePath}
                                      projectStoragePath={project.storagePath}
                                      width={24}
                                      minHeight={18}
                                    />
                                    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {summary.objectType}
                                      </span>
                                      <span className="postgres-users-meta" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {summary.attributeDefinitionCount} attributes
                                      </span>
                                    </div>
                                  </div>
                                </td>
                                <td className="users-td users-td--muted">{summary.count}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {objectTypeSummaries.length === 0 ? (
                          <div className="empty-state" style={{ minHeight: 140 }}>
                            <p>No object types yet.</p>
                          </div>
                        ) : null}
                        {openObjectTypeActionsMenu ? (
                          <div
                            role="menu"
                            style={{
                              position: "fixed",
                              left: openObjectTypeActionsMenu.left,
                              top: openObjectTypeActionsMenu.top,
                              zIndex: 1200,
                              minWidth: 164,
                              padding: 6,
                              borderRadius: 10,
                              border: "1px solid rgba(53, 80, 112, 0.16)",
                              background: "rgba(255, 255, 255, 0.99)",
                              boxShadow: "0 16px 32px rgba(15, 23, 42, 0.18)",
                            }}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <button
                              type="button"
                              role="menuitem"
                              style={{
                                display: "block",
                                width: "100%",
                                padding: "8px 10px",
                                border: "none",
                                background: "transparent",
                                borderRadius: 8,
                                textAlign: "left",
                                fontSize: 14,
                                fontWeight: 500,
                                color: "#1f2933",
                                cursor: "pointer",
                              }}
                              onClick={() => {
                                openObjectTypeModalForEdit(openObjectTypeActionsMenu.id, "details");
                                setOpenObjectTypeActionsMenu(null);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              style={{
                                display: "block",
                                width: "100%",
                                padding: "8px 10px",
                                border: "none",
                                background: "transparent",
                                borderRadius: 8,
                                textAlign: "left",
                                fontSize: 14,
                                fontWeight: 500,
                                color: "#b42318",
                                cursor: "pointer",
                              }}
                              onClick={() => {
                                setRemovingObjectTypeId(openObjectTypeActionsMenu.id);
                                setOpenObjectTypeActionsMenu(null);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </section>
                  </div>

                  <section
                    className="users-content"
                    style={{
                      alignItems: "stretch",
                      alignSelf: "center",
                      justifyContent: "center",
                      gap: 16,
                      minHeight: 0,
                      maxHeight: "100%",
                      overflowY: "auto",
                      overflowX: "hidden",
                      paddingRight: 4,
                    }}
                  >
                    {graphNotice ? <p className="settings-success">{graphNotice}</p> : null}
                    {graphError ? <p className="auth-error">{graphError}</p> : null}
                    <div className="ai-assist-home-tabbar" style={{ marginBottom: 0 }}>
                      <div className="segmented-control" role="tablist" aria-label="Object workspace views">
                        <button
                          type="button"
                          className={showObjectAttributesTable ? "segmented-control-option" : "segmented-control-option segmented-control-option--active"}
                          role="tab"
                          aria-selected={!showObjectAttributesTable}
                          onClick={() => setShowObjectAttributesTable(false)}
                        >
                          Details
                        </button>
                        <button
                          type="button"
                          className={showObjectAttributesTable ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                          role="tab"
                          aria-selected={showObjectAttributesTable}
                          onClick={() => setShowObjectAttributesTable(true)}
                        >
                          Attributes
                        </button>
                      </div>
                    </div>
                    {graphLoading ? (
                      <div className="empty-state postgres-users-empty-state">
                        <p>Loading objects...</p>
                      </div>
                    ) : showObjectAttributesTable ? (
                      <>
                        {selectedObjectTypeFilter === "all" ? (
                          <div className="empty-state postgres-users-empty-state">
                            <p>Select an object type in the left column to view its attributes.</p>
                          </div>
                        ) : (
                          <div className="users-table-wrap case-attributes-table-wrap">
                            <table className="users-table case-attributes-table">
                              <thead>
                                <tr>
                                  <th
                                    className={`users-th case-attributes-case-col${objectAttributeSortCol === "name" ? " users-th--sorted" : ""}`}
                                    onClick={() => handleObjectAttributeSort("name")}
                                  >
                                    Object
                                    <span className="users-sort-icon">
                                      {objectAttributeSortCol === "name" ? (objectAttributeSortDir === "asc" ? " ↑" : " ↓") : " ↕"}
                                    </span>
                                  </th>
                                  {objectAttributeDefinitionsForWorkspace.map((definition) => (
                                    <th
                                      key={definition.id}
                                      className={`users-th case-attributes-value-col${objectAttributeSortCol === definition.id ? " users-th--sorted" : ""}`}
                                      onClick={() => handleObjectAttributeSort(definition.id)}
                                    >
                                      {definition.name}
                                      <span className="users-sort-icon">
                                        {objectAttributeSortCol === definition.id ? (objectAttributeSortDir === "asc" ? " ↑" : " ↓") : " ↕"}
                                      </span>
                                      <span className="case-attribute-type-label">{definition.dataType}</span>
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {sortedObjectAttributeRows.length === 0 ? (
                                  <tr>
                                    <td colSpan={Math.max(objectAttributeDefinitionsForWorkspace.length + 1, 1)} className="users-td-msg">
                                      {`No ${objectTypeById.get(selectedObjectTypeFilter)?.name ?? "selected"} objects yet.`}
                                    </td>
                                  </tr>
                                ) : (
                                  sortedObjectAttributeRows.map((row) => (
                                    <tr key={row.id} className="case-attributes-row">
                                      <td className="users-td users-td--name case-attributes-case-cell">{row.name}</td>
                                      {objectAttributeDefinitionsForWorkspace.map((definition) => {
                                        const rawValue = row.valuesByDefinitionId[definition.id] ?? "";
                                        const cellActive = activeObjectAttributeHistoryCell?.objectId === row.id
                                          && activeObjectAttributeHistoryCell.attributeDefinitionId === definition.id;
                                        const openHistory = () => {
                                          setActiveObjectAttributeHistoryCell({
                                            objectId: row.id,
                                            attributeDefinitionId: definition.id,
                                          });
                                          setAttributeHistoryTarget({
                                            projectId: project.id,
                                            ownerKind: "object",
                                            ownerId: row.id,
                                            ownerName: row.name || "Untitled object",
                                            attributeDefinitionId: definition.id,
                                            attributeName: definition.name,
                                          });
                                        };
                                        return (
                                          <td
                                            key={definition.id}
                                            className={`users-td case-attributes-value-cell${cellActive ? " case-attributes-cell--active" : ""}`}
                                            role="button"
                                            tabIndex={0}
                                            title="View attribute value history"
                                            onClick={openHistory}
                                            onKeyDown={(event) => {
                                              if (event.key !== "Enter" && event.key !== " ") return;
                                              event.preventDefault();
                                              openHistory();
                                            }}
                                          >
                                            {rawValue
                                              ? formatPostgresAttributeDisplay(rawValue, definition.dataType)
                                              : <span className="cases-no-docs">-</span>}
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    ) : filteredObjects.length === 0 ? (
                      <div className="empty-state postgres-users-empty-state">
                        <p>
                          {selectedObjectTypeFilter === "all"
                            ? "No objects yet."
                            : `No ${objectTypeById.get(selectedObjectTypeFilter)?.name ?? "selected"} objects yet.`}
                        </p>
                      </div>
                    ) : (
                      <div className="users-table-wrap postgres-users-table-wrap">
                        <table className="users-table">
                          <thead>
                            <tr>
                              <th className="users-th" style={{ width: "42%" }}>Title</th>
                              <th className="users-th" style={{ width: "30%" }}>Type</th>
                              <th className="users-th" style={{ width: "28%" }}>Updated</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredObjects.map((object) => {
                              return (
                                <tr
                                  key={object.id}
                                  className="users-row"
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => setSelectedObjectDetailsId(object.id)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      event.preventDefault();
                                      setSelectedObjectDetailsId(object.id);
                                    }
                                  }}
                                  style={{
                                    background: selectedObjectDetailsId === object.id ? "rgba(53, 80, 112, 0.10)" : undefined,
                                    cursor: "pointer",
                                  }}
                                >
                                  <td className="users-td users-td--name">{object.title}</td>
                                  <td className="users-td users-td--muted">{object.objectType}</td>
                                  <td className="users-td users-td--muted">
                                    {formatCurrentDateTime(object.updatedAt, {
                                      year: "numeric",
                                      month: "short",
                                      day: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                      second: "2-digit",
                                    })}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </div>
                {removingObjectTypeId ? (
                  (() => {
                    const objectTypeRecord = objectTypeById.get(removingObjectTypeId);
                    if (!objectTypeRecord) return null;
                    const affectedObjectCount = customObjects.filter((object) => object.objectTypeId === objectTypeRecord.id).length;
                    return (
                      <div className="modal-overlay" onClick={() => !graphSubmitting && setRemovingObjectTypeId(null)}>
                        <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
                          <h2>Delete object type</h2>
                          <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                            Delete <strong>{objectTypeRecord.name}</strong>?
                          </p>
                          <p className="modal-warning-text">
                            This will delete the object type and all {affectedObjectCount} objects of this type. This cannot be undone.
                          </p>
                          <p className="users-guide-copy" style={{ marginTop: 10, marginBottom: 0 }}>
                            Confirm that you want to permanently delete this object type and its objects.
                          </p>
                          <div className="form-actions" style={{ marginTop: 24 }}>
                            <button type="button" className="btn" onClick={() => setRemovingObjectTypeId(null)} disabled={graphSubmitting}>
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="btn btn--danger"
                              onClick={() => void handleDeleteObjectType(objectTypeRecord.id)}
                              disabled={graphSubmitting}
                            >
                              {graphSubmitting ? "Deleting..." : "Delete object type"}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()
                ) : null}
                {createObjectTypeOpen ? (
                  <div className="modal-overlay" onClick={() => !graphSubmitting && setCreateObjectTypeOpen(false)}>
                    <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
                      <h2>Add object type</h2>
                      <p className="auth-hint" style={{ marginTop: 0 }}>
                        Create a project-specific object type now, then add objects to it whenever you are ready.
                      </p>
                      <form onSubmit={handleCreateObjectType} className="form">
                        <div className="auth-tabs" role="tablist" aria-label="Add object type tabs">
                          <button
                            type="button"
                            className={`auth-tab ${objectTypeModalTab === "details" ? "auth-tab--active" : ""}`}
                            onClick={() => setObjectTypeModalTab("details")}
                          >
                            Details
                          </button>
                          <button
                            type="button"
                            className={`auth-tab ${objectTypeModalTab === "graphics" ? "auth-tab--active" : ""}`}
                            onClick={() => setObjectTypeModalTab("graphics")}
                          >
                            Graphics
                          </button>
                          <button
                            type="button"
                            className={`auth-tab ${objectTypeModalTab === "attributes" ? "auth-tab--active" : ""}`}
                            onClick={() => setObjectTypeModalTab("attributes")}
                          >
                            Attributes
                          </button>
                        </div>
                        {objectTypeModalTab === "details" ? (
                          <>
                            <label className="form-label">
                              Object type name
                              <input
                                className="form-input"
                                value={draftObjectTypeName}
                                onChange={(event) => setDraftObjectTypeName(event.target.value)}
                                autoFocus
                              />
                            </label>
                            <label className="form-label">
                              Description
                              <textarea
                                className="form-input form-textarea"
                                rows={3}
                                value={draftObjectTypeDescription}
                                onChange={(event) => setDraftObjectTypeDescription(event.target.value)}
                              />
                            </label>
                          </>
                        ) : objectTypeModalTab === "graphics" ? (
                          <>
                            <label className="form-label">
                              Image
                              <PostgresObjectImageControls
                                projectStoragePath={project.storagePath}
                                imageStoragePath={draftObjectTypeImageStoragePath}
                                previewUrl={draftObjectTypePendingImage?.previewUrl ?? ""}
                                graphicMode={draftObjectTypeGraphicMode}
                                canUpload={true}
                                disabled={graphSubmitting || imageUploadSubmitting}
                                onUpload={() => void handlePickPendingObjectTypeImage()}
                                onRemove={draftObjectTypePendingImage ? handleRemovePendingObjectTypeImage : undefined}
                                onGraphicModeChange={handleSetObjectTypeGraphicMode}
                                fallback={(
                                  <ObjectShapeSwatch
                                    shape={draftObjectTypeShape}
                                    fill={draftObjectTypeFill}
                                    color={normalizePostgresObjectTypeColor(draftObjectTypeColor)}
                                    width={56}
                                    minHeight={44}
                                  />
                                )}
                              />
                            </label>
                            {draftObjectTypeGraphicMode === "select" ? (
                              <>
                            <label className="form-label">
                              Color
                              <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
                                <input
                                  className="form-input form-input--color"
                                  type="color"
                                  value={draftObjectTypeColor}
                                  onChange={(event) => setDraftObjectTypeColor(event.target.value)}
                                  style={{ width: 92, minWidth: 92, height: 56 }}
                                />
                                <input
                                  className="form-input"
                                  value={draftObjectTypeColor}
                                  onChange={(event) => setDraftObjectTypeColor(event.target.value)}
                                  style={{ flex: "0 0 132px", fontFamily: "monospace" }}
                                />
                              </div>
                            </label>
                            <label className="form-label">
                              Shape
                              <PostgresObjectShapePicker
                                value={draftObjectTypeShape}
                                onChange={(value) => setDraftObjectTypeShape((value || "rounded") as PostgresObjectTypeShape)}
                                previewColor={draftObjectTypeColor}
                                previewFill={draftObjectTypeFill}
                              />
                            </label>
                            <label className="form-label">
                              Fill
                              <PostgresObjectFillPicker
                                value={draftObjectTypeFill}
                                onChange={(value) => setDraftObjectTypeFill((value || "filled") as PostgresObjectFill)}
                                previewColor={draftObjectTypeColor}
                                previewShape={draftObjectTypeShape}
                              />
                            </label>
                              </>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <div className="postgres-attribute-modal-section">
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  gap: 12,
                                  marginBottom: 12,
                                }}
                              >
                                <div className="postgres-attribute-modal-title">Attributes</div>
                                <button type="button" className="btn btn--small" onClick={openNewObjectTypeAttributeModal}>
                                  Add attribute
                                </button>
                              </div>
                              {objectTypeAttributeDrafts.length === 0 ? (
                                <p className="auth-hint" style={{ margin: 0 }}>No attributes for this object type yet.</p>
                              ) : (
                                <div className="postgres-attribute-multiselect">
                                  {objectTypeAttributeDrafts.map((draft) => (
                                    <div key={draft.localId} className="postgres-attribute-option">
                                      <span className="postgres-attribute-option-body">
                                        <strong>{draft.name}</strong>
                                        <span>{draft.dataType}</span>
                                        <span>{draft.description || (draft.options.length > 0 ? draft.options.join(", ") : "No description")}</span>
                                      </span>
                                      <div className="project-card-actions">
                                        <button type="button" className="btn btn--ghost" onClick={() => openEditObjectTypeAttributeModal(draft)}>
                                          Edit
                                        </button>
                                        <button type="button" className="btn btn--ghost-danger" onClick={() => deleteObjectTypeAttributeDraft(draft.localId)}>
                                          Delete
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            {!editingObjectTypeModalId ? (
                              <p className="auth-hint" style={{ marginTop: 0 }}>
                                Attribute drafts will be saved when you create the object type.
                              </p>
                            ) : null}
                          </>
                        )}
                        <div className="form-actions">
                          <button type="button" className="btn" onClick={() => setCreateObjectTypeOpen(false)} disabled={graphSubmitting}>
                            Cancel
                          </button>
                          <button type="submit" className="btn btn--primary" disabled={graphSubmitting}>
                            {graphSubmitting ? "Saving..." : "Create object type"}
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                ) : null}
                {editingObjectTypeModalId ? (
                  <div className="modal-overlay" onClick={() => !graphSubmitting && setEditingObjectTypeModalId(null)}>
                    <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
                      <h2>Edit object type</h2>
                      <p className="auth-hint" style={{ marginTop: 0 }}>
                        Update the default node appearance for this object type. Existing objects will inherit the change unless they override it.
                      </p>
                      <form onSubmit={handleSaveObjectType} className="form">
                        <div className="auth-tabs" role="tablist" aria-label="Edit object type tabs">
                          <button
                            type="button"
                            className={`auth-tab ${objectTypeModalTab === "details" ? "auth-tab--active" : ""}`}
                            onClick={() => setObjectTypeModalTab("details")}
                          >
                            Details
                          </button>
                          <button
                            type="button"
                            className={`auth-tab ${objectTypeModalTab === "graphics" ? "auth-tab--active" : ""}`}
                            onClick={() => setObjectTypeModalTab("graphics")}
                          >
                            Graphics
                          </button>
                          <button
                            type="button"
                            className={`auth-tab ${objectTypeModalTab === "attributes" ? "auth-tab--active" : ""}`}
                            onClick={() => setObjectTypeModalTab("attributes")}
                          >
                            Attributes
                          </button>
                        </div>
                        {objectTypeModalTab === "details" ? (
                          <>
                            <label className="form-label">
                              Object type name
                              <input
                                className="form-input"
                                value={draftObjectTypeName}
                                onChange={(event) => setDraftObjectTypeName(event.target.value)}
                                autoFocus
                              />
                            </label>
                            <label className="form-label">
                              Description
                              <textarea
                                className="form-input form-textarea"
                                rows={3}
                                value={draftObjectTypeDescription}
                                onChange={(event) => setDraftObjectTypeDescription(event.target.value)}
                              />
                            </label>
                          </>
                        ) : objectTypeModalTab === "graphics" ? (
                          <>
                            <label className="form-label">
                              Image
                              <PostgresObjectImageControls
                                projectStoragePath={project.storagePath}
                                imageStoragePath={draftObjectTypeImageStoragePath}
                                graphicMode={draftObjectTypeGraphicMode}
                                canUpload={!!editingObjectTypeModalId}
                                disabled={graphSubmitting || imageUploadSubmitting}
                                onUpload={() => editingObjectTypeModalId ? void handleImportObjectTypeImage(editingObjectTypeModalId) : undefined}
                                onRemove={() => editingObjectTypeModalId ? void handleRemoveObjectTypeImage(editingObjectTypeModalId) : undefined}
                                onGraphicModeChange={handleSetObjectTypeGraphicMode}
                                fallback={(
                                  <ObjectShapeSwatch
                                    shape={draftObjectTypeShape}
                                    fill={draftObjectTypeFill}
                                    color={normalizePostgresObjectTypeColor(draftObjectTypeColor)}
                                    width={56}
                                    minHeight={44}
                                  />
                                )}
                              />
                            </label>
                            {draftObjectTypeGraphicMode === "select" ? (
                              <>
                            <label className="form-label">
                              Color
                              <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
                                <input
                                  className="form-input form-input--color"
                                  type="color"
                                  value={draftObjectTypeColor}
                                  onChange={(event) => setDraftObjectTypeColor(event.target.value)}
                                  style={{ width: 92, minWidth: 92, height: 56 }}
                                />
                                <input
                                  className="form-input"
                                  value={draftObjectTypeColor}
                                  onChange={(event) => setDraftObjectTypeColor(event.target.value)}
                                  style={{ flex: "0 0 132px", fontFamily: "monospace" }}
                                />
                              </div>
                            </label>
                            <label className="form-label">
                              Shape
                              <PostgresObjectShapePicker
                                value={draftObjectTypeShape}
                                onChange={(value) => setDraftObjectTypeShape((value || "rounded") as PostgresObjectTypeShape)}
                                previewColor={draftObjectTypeColor}
                                previewFill={draftObjectTypeFill}
                              />
                            </label>
                            <label className="form-label">
                              Fill
                              <PostgresObjectFillPicker
                                value={draftObjectTypeFill}
                                onChange={(value) => setDraftObjectTypeFill((value || "filled") as PostgresObjectFill)}
                                previewColor={draftObjectTypeColor}
                                previewShape={draftObjectTypeShape}
                              />
                            </label>
                              </>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <div className="postgres-attribute-modal-section">
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  gap: 12,
                                  marginBottom: 12,
                                }}
                              >
                                <div className="postgres-attribute-modal-title">Attributes</div>
                                <button type="button" className="btn btn--small" onClick={openNewObjectTypeAttributeModal}>
                                  Add attribute
                                </button>
                              </div>
                              {objectTypeAttributeDrafts.length === 0 ? (
                                <p className="auth-hint" style={{ margin: 0 }}>No attributes for this object type yet.</p>
                              ) : (
                                <div className="postgres-attribute-multiselect">
                                  {objectTypeAttributeDrafts.map((draft) => (
                                    <div key={draft.localId} className="postgres-attribute-option">
                                      <span className="postgres-attribute-option-body">
                                        <strong>{draft.name}</strong>
                                        <span>{draft.dataType}</span>
                                        <span>{draft.description || (draft.options.length > 0 ? draft.options.join(", ") : "No description")}</span>
                                      </span>
                                      <div className="project-card-actions">
                                        <button type="button" className="btn btn--ghost" onClick={() => openEditObjectTypeAttributeModal(draft)}>
                                          Edit
                                        </button>
                                        <button type="button" className="btn btn--ghost-danger" onClick={() => deleteObjectTypeAttributeDraft(draft.localId)}>
                                          Delete
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            <p className="auth-hint" style={{ marginTop: 16, marginBottom: 0 }}>
                              Attribute changes will be saved when you save the object type.
                            </p>
                          </>
                        )}
                        <div className="form-actions">
                          <button type="button" className="btn" onClick={() => setEditingObjectTypeModalId(null)} disabled={graphSubmitting}>
                            Cancel
                          </button>
                          <button type="submit" className="btn btn--primary" disabled={graphSubmitting}>
                            {graphSubmitting ? "Saving..." : "Save changes"}
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                ) : null}
                {objectTypeAttributeModalDraft ? (
                  <AttributeDefinitionModal
                    draft={objectTypeAttributeModalDraft}
                    saving={graphSubmitting}
                    error={typeAttributeModalError}
                    title={objectTypeAttributeModalDraft.id ? "Edit object attribute" : "Create object attribute"}
                    onCancel={() => {
                      if (graphSubmitting) return;
                      setObjectTypeAttributeModalDraft(null);
                      setTypeAttributeModalError("");
                    }}
                    onSave={saveObjectTypeAttributeDraft}
                  />
                ) : null}
                {objectWorkspaceAttributeDraft ? (
                  <TypeScopedAttributeModal
                    draft={objectWorkspaceAttributeDraft}
                    typeOptions={objectWorkspaceAttributeTypeOptions}
                    title="Create object attribute"
                    typeLabel="Object"
                    saving={graphSubmitting}
                    error={objectWorkspaceAttributeError}
                    onCancel={() => {
                      if (graphSubmitting) return;
                      setObjectWorkspaceAttributeDraft(null);
                      setObjectWorkspaceAttributeError("");
                    }}
                    onSave={(draft) => {
                      void handleCreateObjectWorkspaceAttribute(draft);
                    }}
                  />
                ) : null}
                {removingObjectId ? (
                  (() => {
                    const object = objects.find((entry) => entry.id === removingObjectId);
                    if (!object) return null;
                    return (
                      <div className="modal-overlay" onClick={() => !graphSubmitting && setRemovingObjectId(null)}>
                        <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
                          <h2>Delete object</h2>
                          <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                            Delete <strong>{object.title}</strong>?
                          </p>
                          <p className="modal-warning-text">
                            This permanently removes the object and any relationships connected to it.
                          </p>
                          <div className="form-actions" style={{ marginTop: 24 }}>
                            <button type="button" className="btn" onClick={() => setRemovingObjectId(null)} disabled={graphSubmitting}>
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="btn btn--danger"
                              onClick={() => void handleDeleteObject(object.id)}
                              disabled={graphSubmitting}
                            >
                              {graphSubmitting ? "Deleting..." : "Delete object"}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()
                ) : null}
                {attributeHistoryTarget ? (
                  <PostgresAttributeValueHistoryModal
                    target={attributeHistoryTarget}
                    onClose={() => {
                      setAttributeHistoryTarget(null);
                      setActiveObjectAttributeHistoryCell(null);
                      setActiveRelationshipAttributeHistoryCell(null);
                    }}
                  />
                ) : null}
              </div>
            </>
          ) : activeScreen === "relationships" && selectedRelationshipDetails ? (
            (() => {
              const fromObject = objectById.get(selectedRelationshipDetails.fromObjectId);
              const toObject = objectById.get(selectedRelationshipDetails.toObjectId);
              return (
                <div className="view users-view">
                  {graphNotice ? <p className="settings-success">{graphNotice}</p> : null}
                  {graphError ? <p className="auth-error">{graphError}</p> : null}
                  <div className="view doc-detail-view" style={{ padding: 0 }}>
                    <div className="workspace-back-row workspace-back-row--split">
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setSelectedRelationshipDetailsId(null)}
                      >
                        Back
                      </button>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => openEditRelationshipModal(selectedRelationshipDetails)}
                        >
                          Edit Relationship
                        </button>
                        <button
                          type="button"
                          className="btn btn--danger"
                          onClick={() => setRemovingRelationshipId(selectedRelationshipDetails.id)}
                        >
                          Delete Relationship
                        </button>
                      </div>
                    </div>

                    <div className="doc-detail-layout">
                      <div className="doc-detail-left">
                        <div className="case-card">
                          <h3 className="case-card-title">Appearance</h3>
                          {selectedRelationshipDetailsAppearance ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
                              <RelationshipTypeLinePreview
                                lineShape={selectedRelationshipDetailsAppearance.lineShape}
                                lineWeight={selectedRelationshipDetailsAppearance.lineWeight}
                                arrowhead={selectedRelationshipDetailsAppearance.arrowhead}
                                color={selectedRelationshipDetailsAppearance.color}
                              />
                              <p className="case-card-value" style={{ margin: 0 }}>
                                {selectedRelationshipDetails.relationshipType || "Relationship"}
                              </p>
                            </div>
                          ) : null}
                        </div>

                        <div className="case-card">
                          <h3 className="case-card-title">Attributes</h3>
                          {selectedRelationshipDetailsAttributeDefinitions.length > 0 ? (
                            <div className="case-detail-attributes-table-wrap">
                              <table className="case-detail-attributes-table">
                                <thead>
                                  <tr>
                                    <th className="case-detail-attributes-label" scope="col">Attribute</th>
                                    <th className="case-detail-attributes-value" scope="col">Value</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {selectedRelationshipDetailsAttributeDefinitions.map((definition) => {
                                    const rawValue = selectedRelationshipDetails.attributeValues.find(
                                      (value) => value.attributeDefinitionId === definition.id,
                                    )?.value ?? "";
                                    return (
                                      <tr key={definition.id}>
                                        <th className="case-detail-attributes-label" scope="row">{definition.name}</th>
                                        <td className="case-detail-attributes-value">
                                          <button
                                            type="button"
                                            className="case-detail-attribute-value-button"
                                            onClick={() => setAttributeHistoryTarget({
                                              projectId: project.id,
                                              ownerKind: "relationship",
                                              ownerId: selectedRelationshipDetails.id,
                                              ownerName: selectedRelationshipDetails.relationshipType || "Relationship",
                                              attributeDefinitionId: definition.id,
                                              attributeName: definition.name,
                                            })}
                                            title="View attribute value history"
                                          >
                                            {rawValue ? formatPostgresAttributeDisplay(rawValue, definition.dataType) : "-"}
                                          </button>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="case-card-empty">No shared attributes for this relationship type yet.</p>
                          )}
                        </div>
                      </div>

                      <div className="doc-detail-right doc-detail-right--annotation">
                        <div className="case-card">
                          <h3 className="case-card-title">Details</h3>
                          <p className="case-card-value">{selectedRelationshipDetails.relationshipType || "Relationship"}</p>
                          <dl className="user-detail-meta case-detail-meta" style={{ marginTop: 16 }}>
                            <dt>From</dt>
                            <dd>{fromObject ? `${fromObject.title} (${fromObject.objectType})` : selectedRelationshipDetails.fromEntityName || selectedRelationshipDetails.fromObjectId}</dd>
                            <dt>To</dt>
                            <dd>{toObject ? `${toObject.title} (${toObject.objectType})` : selectedRelationshipDetails.toEntityName || selectedRelationshipDetails.toObjectId}</dd>
                            <dt>Relationship type</dt>
                            <dd>{selectedRelationshipDetailsType?.name ?? selectedRelationshipDetails.relationshipType ?? "-"}</dd>
                            <dt>Created</dt>
                            <dd>
                              {formatCurrentDateTime(selectedRelationshipDetails.createdAt, {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                              })}
                            </dd>
                            <dt>Updated</dt>
                            <dd>
                              {formatCurrentDateTime(selectedRelationshipDetails.updatedAt, {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                              })}
                            </dd>
                          </dl>
                          <div style={{ marginTop: 18 }}>
                            <h3 className="case-card-title">Description</h3>
                            {selectedRelationshipDetails.description.trim() ? (
                              <p style={{ margin: 0, lineHeight: 1.6, overflowWrap: "anywhere" }}>
                                {selectedRelationshipDetails.description}
                              </p>
                            ) : (
                              <p className="case-card-empty">No description yet.</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  {attributeHistoryTarget ? (
                    <PostgresAttributeValueHistoryModal
                      target={attributeHistoryTarget}
                      onClose={() => {
                        setAttributeHistoryTarget(null);
                        setActiveObjectAttributeHistoryCell(null);
                        setActiveRelationshipAttributeHistoryCell(null);
                      }}
                    />
                  ) : null}
                </div>
              );
            })()
          ) : activeScreen === "relationships" ? (
            <>
              <div className="view users-view">
                <header className="view-header">
                  <div className="users-title-wrap">
                    <h1>Relationships</h1>
                  </div>
                  <div className="view-header-actions">
                    {showRelationshipAttributesTable && selectedRelationshipTypeFilter !== "all" ? (
                      <button
                        type="button"
                        className="btn btn--primary"
                        onClick={openRelationshipWorkspaceAttributeModal}
                        disabled={graphSubmitting || relationshipWorkspaceAttributeTypeOptions.length === 0}
                      >
                        Add Attribute
                      </button>
                    ) : !showRelationshipAttributesTable ? (
                      <>
                        <button
                          type="button"
                          className="btn"
                          onClick={openCreateRelationshipTypeModal}
                        >
                          Add relationship type
                        </button>
                        <button type="button" className="btn btn--primary" onClick={() => openCreateRelationshipModal()}>
                          New relationship
                        </button>
                      </>
                    ) : null}
                  </div>
                </header>

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
                      justifyContent: "center",
                      minHeight: 0,
                      maxHeight: "100%",
                      overflowY: "auto",
                      overflowX: "hidden",
                      paddingRight: 4,
                    }}
                  >
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
                          <h2 style={{ margin: 0, fontSize: 18 }}>Relationship types</h2>
                          <span className="home-restricted-value">{relationshipTypeSummaries.length}</span>
                        </div>
                        <input
                          className="form-input"
                          value={relationshipTypeSearchTerm}
                          onChange={(event) => setRelationshipTypeSearchTerm(event.target.value)}
                          placeholder="Search relationship types"
                        />
                      </div>

                      <div style={{ maxHeight: 560, overflowY: "auto" }}>
                        <table className="users-table" style={{ tableLayout: "fixed" }}>
                          <thead>
                            <tr>
                              <th className="users-th" style={{ width: "76%" }}>Type</th>
                              <th className="users-th" style={{ width: "24%" }}>Count</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr
                              className="users-row"
                              style={{
                                background: selectedRelationshipTypeFilter === "all" ? "rgba(53, 80, 112, 0.10)" : undefined,
                              }}
                            >
                              <td
                                className="users-td users-td--name"
                                role="button"
                                tabIndex={0}
                                onClick={() => {
                                  setSelectedRelationshipTypeFilter("all");
                                  setRelationshipTypeId("");
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    setSelectedRelationshipTypeFilter("all");
                                    setRelationshipTypeId("");
                                  }
                                }}
                              >
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  <span>All relationships</span>
                                  <span className="postgres-users-meta">Across every relationship type</span>
                                </div>
                              </td>
                              <td className="users-td users-td--muted">{relationships.length}</td>
                            </tr>
                            {filteredRelationshipTypeSummaries.map((summary) => (
                              <tr
                                key={summary.relationshipTypeId}
                                className="users-row"
                                onContextMenu={(event) => {
                                  event.preventDefault();
                                  setOpenRelationshipActionsMenu(null);
                                  setOpenRelationshipTypeActionsMenu({
                                    id: summary.relationshipTypeId,
                                    left: Math.min(event.clientX, window.innerWidth - 168),
                                    top: Math.min(event.clientY, window.innerHeight - 96),
                                  });
                                }}
                                style={{
                                  background: selectedRelationshipTypeFilter === summary.relationshipTypeId ? "rgba(53, 80, 112, 0.10)" : undefined,
                                  cursor: "context-menu",
                                }}
                              >
                                <td
                                  className="users-td users-td--name"
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => {
                                    setSelectedRelationshipTypeFilter(summary.relationshipTypeId);
                                    setRelationshipTypeId(summary.relationshipTypeId);
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      event.preventDefault();
                                      setSelectedRelationshipTypeFilter(summary.relationshipTypeId);
                                      setRelationshipTypeId(summary.relationshipTypeId);
                                    }
                                  }}
                                >
                                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                                    <RelationshipTypeLinePreview
                                      lineShape={summary.lineShape}
                                      lineWeight={summary.lineWeight}
                                      arrowhead={summary.arrowhead}
                                      color={summary.color}
                                    />
                                    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {summary.relationshipType}
                                      </span>
                                      <span className="postgres-users-meta" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                        {formatPostgresRelationshipLineShapeLabel(summary.lineShape)}
                                        {" / "}
                                        {formatPostgresRelationshipLineWeightLabel(summary.lineWeight)}
                                        {" / "}
                                        {formatPostgresRelationshipArrowheadLabel(summary.arrowhead)}
                                        {" / "}
                                        {summary.attributeDefinitionCount} attributes
                                      </span>
                                    </div>
                                  </div>
                                </td>
                                <td className="users-td users-td--muted">{summary.count}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {openRelationshipTypeActionsMenu ? (
                          <div
                            role="menu"
                            style={{
                              position: "fixed",
                              left: openRelationshipTypeActionsMenu.left,
                              top: openRelationshipTypeActionsMenu.top,
                              zIndex: 1200,
                              minWidth: 164,
                              padding: 6,
                              borderRadius: 10,
                              border: "1px solid rgba(53, 80, 112, 0.16)",
                              background: "rgba(255, 255, 255, 0.99)",
                              boxShadow: "0 16px 32px rgba(15, 23, 42, 0.18)",
                            }}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <button
                              type="button"
                              role="menuitem"
                              style={{
                                display: "block",
                                width: "100%",
                                padding: "8px 10px",
                                border: "none",
                                background: "transparent",
                                borderRadius: 8,
                                textAlign: "left",
                                fontSize: 14,
                                fontWeight: 500,
                                color: "#1f2933",
                                cursor: "pointer",
                              }}
                              onClick={() => {
                                const relationshipType = relationshipTypeById.get(openRelationshipTypeActionsMenu.id);
                                if (!relationshipType) return;
                                setEditingRelationshipTypeModalId(relationshipType.id);
                                setDraftRelationshipTypeName(relationshipType.name);
                                setDraftRelationshipLineShape(normalizePostgresRelationshipLineShape(relationshipType.lineShape));
                                setDraftRelationshipLineWeight(normalizePostgresRelationshipLineWeight(relationshipType.lineWeight));
                                setDraftRelationshipArrowhead(normalizePostgresRelationshipArrowhead(relationshipType.arrowhead));
                                setDraftRelationshipColor(normalizePostgresRelationshipColor(relationshipType.color));
                                setDraftRelationshipFromObjectTypeIds(expandPostgresRelationshipRestrictionSelection(relationshipType.fromObjectTypeIds, allObjectTypeIds));
                                setDraftRelationshipToObjectTypeIds(expandPostgresRelationshipRestrictionSelection(relationshipType.toObjectTypeIds, allObjectTypeIds));
                                setDraftRelationshipFromSourceKinds(expandPostgresRelationshipRestrictionSelection(relationshipType.fromSourceKinds, allSourceKindIds));
                                setDraftRelationshipToSourceKinds(expandPostgresRelationshipRestrictionSelection(relationshipType.toSourceKinds, allSourceKindIds));
                                setRelationshipTypeModalTab("details");
                                initializeRelationshipTypeAttributeEditor(relationshipType.id);
                                setGraphError("");
                                setOpenRelationshipTypeActionsMenu(null);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              style={{
                                display: "block",
                                width: "100%",
                                padding: "8px 10px",
                                border: "none",
                                background: "transparent",
                                borderRadius: 8,
                                textAlign: "left",
                                fontSize: 14,
                                fontWeight: 500,
                                color: "#b42318",
                                cursor: "pointer",
                              }}
                              onClick={() => {
                                setRemovingRelationshipTypeId(openRelationshipTypeActionsMenu.id);
                                setOpenRelationshipTypeActionsMenu(null);
                                setGraphError("");
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        ) : null}
                        {filteredRelationshipTypeSummaries.length === 0 ? (
                          <div className="empty-state" style={{ minHeight: 140 }}>
                            <p>No relationship types match that search.</p>
                          </div>
                        ) : null}
                      </div>
                    </section>
                  </div>

                  <section
                    className="users-content"
                    style={{
                      alignItems: "stretch",
                      alignSelf: "center",
                      justifyContent: "center",
                      gap: 16,
                      minHeight: 0,
                      maxHeight: "100%",
                      overflowY: "auto",
                      overflowX: "hidden",
                      paddingRight: 4,
                    }}
                  >
                    {graphNotice ? <p className="settings-success">{graphNotice}</p> : null}
                    {graphError ? <p className="auth-error">{graphError}</p> : null}

                    <div className="ai-assist-home-tabbar" style={{ marginBottom: 0 }}>
                      <div className="segmented-control" role="tablist" aria-label="Relationship workspace views">
                        <button
                          type="button"
                          className={showRelationshipAttributesTable ? "segmented-control-option" : "segmented-control-option segmented-control-option--active"}
                          role="tab"
                          aria-selected={!showRelationshipAttributesTable}
                          onClick={() => setShowRelationshipAttributesTable(false)}
                        >
                          Details
                        </button>
                        <button
                          type="button"
                          className={showRelationshipAttributesTable ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                          role="tab"
                          aria-selected={showRelationshipAttributesTable}
                          onClick={() => setShowRelationshipAttributesTable(true)}
                        >
                          Attributes
                        </button>
                      </div>
                    </div>

                    {graphLoading ? (
                      <div className="empty-state postgres-users-empty-state">
                        <p>Loading relationships...</p>
                      </div>
                    ) : showRelationshipAttributesTable ? (
                      <>
                        {selectedRelationshipTypeFilter === "all" ? (
                          <div className="empty-state postgres-users-empty-state">
                            <p>Select a relationship type in the left column to view its attributes.</p>
                          </div>
                        ) : relationshipAttributeDefinitionsForWorkspace.length === 0 ? (
                          <div className="empty-state postgres-users-empty-state">
                            <p>
                              {`${relationshipTypeById.get(selectedRelationshipTypeFilter)?.name ?? "Selected relationship type"} has no attributes.`}
                            </p>
                          </div>
                        ) : (
                          <div className="users-table-wrap case-attributes-table-wrap">
                            <table className="users-table case-attributes-table">
                              <thead>
                                <tr>
                                  <th
                                    className={`users-th case-attributes-case-col${relationshipAttributeSortCol === "name" ? " users-th--sorted" : ""}`}
                                    onClick={() => handleRelationshipAttributeSort("name")}
                                  >
                                    Relationship
                                    <span className="users-sort-icon">
                                      {relationshipAttributeSortCol === "name" ? (relationshipAttributeSortDir === "asc" ? " \u2191" : " \u2193") : " \u2195"}
                                    </span>
                                  </th>
                                  {relationshipAttributeDefinitionsForWorkspace.map((definition) => (
                                    <th
                                      key={definition.id}
                                      className={`users-th case-attributes-value-col${relationshipAttributeSortCol === definition.id ? " users-th--sorted" : ""}`}
                                      onClick={() => handleRelationshipAttributeSort(definition.id)}
                                    >
                                      {definition.name}
                                      <span className="users-sort-icon">
                                        {relationshipAttributeSortCol === definition.id ? (relationshipAttributeSortDir === "asc" ? " \u2191" : " \u2193") : " \u2195"}
                                      </span>
                                      <span className="case-attribute-type-label">{definition.dataType}</span>
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {sortedRelationshipAttributeRows.length === 0 ? (
                                  <tr>
                                    <td colSpan={Math.max(relationshipAttributeDefinitionsForWorkspace.length + 1, 1)} className="users-td-msg">
                                      {`No ${relationshipTypeById.get(selectedRelationshipTypeFilter)?.name ?? "selected"} relationships yet.`}
                                    </td>
                                  </tr>
                                ) : (
                                  sortedRelationshipAttributeRows.map((row) => (
                                    <tr key={row.id} className="case-attributes-row">
                                      <td className="users-td users-td--name case-attributes-case-cell">{row.name}</td>
                                      {relationshipAttributeDefinitionsForWorkspace.map((definition) => {
                                        const rawValue = row.valuesByDefinitionId[definition.id] ?? "";
                                        const cellActive = activeRelationshipAttributeHistoryCell?.relationshipId === row.id
                                          && activeRelationshipAttributeHistoryCell.attributeDefinitionId === definition.id;
                                        const openHistory = () => {
                                          setActiveRelationshipAttributeHistoryCell({
                                            relationshipId: row.id,
                                            attributeDefinitionId: definition.id,
                                          });
                                          setAttributeHistoryTarget({
                                            projectId: project.id,
                                            ownerKind: "relationship",
                                            ownerId: row.id,
                                            ownerName: row.name || "Relationship",
                                            attributeDefinitionId: definition.id,
                                            attributeName: definition.name,
                                          });
                                        };
                                        return (
                                          <td
                                            key={definition.id}
                                            className={`users-td case-attributes-value-cell${cellActive ? " case-attributes-cell--active" : ""}`}
                                            role="button"
                                            tabIndex={0}
                                            title="View attribute value history"
                                            onClick={openHistory}
                                            onKeyDown={(event) => {
                                              if (event.key !== "Enter" && event.key !== " ") return;
                                              event.preventDefault();
                                              openHistory();
                                            }}
                                          >
                                            {rawValue
                                              ? formatPostgresAttributeDisplay(rawValue, definition.dataType)
                                              : <span className="cases-no-docs">-</span>}
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    ) : filteredRelationships.length === 0 ? (
                      <div className="empty-state postgres-users-empty-state">
                        <p>
                          {selectedRelationshipTypeFilter === "all"
                            ? "No relationships yet."
                            : `No ${relationshipTypeById.get(selectedRelationshipTypeFilter)?.name ?? "selected"} relationships yet.`}
                        </p>
                      </div>
                    ) : (
                      <div className="users-table-wrap postgres-users-table-wrap">
                        <table className="users-table">
                          <thead>
                            <tr>
                              <th className="users-th" style={{ width: "28%" }}>Type</th>
                              <th className="users-th" style={{ width: "28%" }}>From</th>
                              <th className="users-th" style={{ width: "28%" }}>To</th>
                              <th className="users-th" style={{ width: "16%" }}>Updated</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredRelationships.map((relationship) => {
                              const fromObject = objectById.get(relationship.fromObjectId);
                              const toObject = objectById.get(relationship.toObjectId);
                              return (
                                <tr
                                  key={relationship.id}
                                  className="users-row"
                                  style={{ cursor: "pointer" }}
                                  onClick={() => setSelectedRelationshipDetailsId(relationship.id)}
                                  onContextMenu={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    setOpenRelationshipTypeActionsMenu(null);
                                    setOpenRelationshipActionsMenu({
                                      id: relationship.id,
                                      left: Math.min(event.clientX, window.innerWidth - 180),
                                      top: Math.min(event.clientY, window.innerHeight - 112),
                                    });
                                  }}
                                >
                                  <td className="users-td users-td--name">
                                    {relationship.relationshipType}
                                    {openRelationshipActionsMenu?.id === relationship.id ? (
                                      <div
                                        role="menu"
                                        style={{
                                          position: "fixed",
                                          left: openRelationshipActionsMenu.left,
                                          top: openRelationshipActionsMenu.top,
                                          zIndex: 1200,
                                          minWidth: 164,
                                          padding: 6,
                                          borderRadius: 10,
                                          border: "1px solid rgba(53, 80, 112, 0.16)",
                                          background: "rgba(255, 255, 255, 0.99)",
                                          boxShadow: "0 16px 32px rgba(15, 23, 42, 0.18)",
                                        }}
                                        onClick={(event) => event.stopPropagation()}
                                      >
                                        <button
                                          type="button"
                                          role="menuitem"
                                          style={{
                                            display: "block",
                                            width: "100%",
                                            padding: "8px 10px",
                                            border: "none",
                                            background: "transparent",
                                            borderRadius: 8,
                                            textAlign: "left",
                                            fontSize: 14,
                                            fontWeight: 500,
                                            color: "#1f2933",
                                            cursor: "pointer",
                                          }}
                                          onClick={() => {
                                            openEditRelationshipModal(relationship);
                                            setOpenRelationshipActionsMenu(null);
                                          }}
                                        >
                                          Edit
                                        </button>
                                        <button
                                          type="button"
                                          role="menuitem"
                                          style={{
                                            display: "block",
                                            width: "100%",
                                            padding: "8px 10px",
                                            border: "none",
                                            background: "transparent",
                                            borderRadius: 8,
                                            textAlign: "left",
                                            fontSize: 14,
                                            fontWeight: 500,
                                            color: "#b42318",
                                            cursor: "pointer",
                                          }}
                                          onClick={() => {
                                            setRemovingRelationshipId(relationship.id);
                                            setOpenRelationshipActionsMenu(null);
                                          }}
                                        >
                                          Delete
                                        </button>
                                      </div>
                                    ) : null}
                                  </td>
                                  <td className="users-td users-td--muted">
                                    {fromObject ? `${fromObject.title} (${fromObject.objectType})` : relationship.fromObjectId}
                                  </td>
                                  <td className="users-td users-td--muted">
                                    {toObject ? `${toObject.title} (${toObject.objectType})` : relationship.toObjectId}
                                  </td>
                                  <td className="users-td users-td--muted">
                                    {formatCurrentDateTime(relationship.updatedAt, {
                                      year: "numeric",
                                      month: "short",
                                      day: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                      second: "2-digit",
                                    })}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </div>
              </div>
              {editingRelationshipTypeModalId ? (
                renderRelationshipTypeModal({
                  title: "Edit relationship type",
                  hint: "Update the default line appearance and object type constraints for this relationship type.",
                  submitLabel: "Save changes",
                  ariaLabel: "Edit relationship type tabs",
                  onClose: () => setEditingRelationshipTypeModalId(null),
                  onSubmit: handleSaveRelationshipType,
                })
              ) : null}
              {removingRelationshipTypeId ? (
                (() => {
                  const relationshipTypeRecord = relationshipTypeById.get(removingRelationshipTypeId);
                  if (!relationshipTypeRecord) return null;
                  const affectedRelationshipCount = relationships.filter(
                    (relationship) => relationship.relationshipTypeId === relationshipTypeRecord.id,
                  ).length;
                  return (
                    <div className="modal-overlay" onClick={() => !graphSubmitting && setRemovingRelationshipTypeId(null)}>
                      <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
                        <h2>Delete relationship type</h2>
                        <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                          Delete <strong>{relationshipTypeRecord.name}</strong>?
                        </p>
                        <p className="modal-warning-text">
                          This will delete the relationship type, its shared attribute definitions, and all {affectedRelationshipCount} relationships of this type. This cannot be undone.
                        </p>
                        <div className="form-actions" style={{ marginTop: 24 }}>
                          <button type="button" className="btn" onClick={() => setRemovingRelationshipTypeId(null)} disabled={graphSubmitting}>
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="btn btn--danger"
                            onClick={() => void handleDeleteRelationshipType(relationshipTypeRecord.id)}
                            disabled={graphSubmitting}
                          >
                            {graphSubmitting ? "Deleting..." : "Delete relationship type"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()
              ) : null}
              {removingRelationshipId ? (
                (() => {
                  const relationship = relationships.find((entry) => entry.id === removingRelationshipId);
                  if (!relationship) return null;
                  return (
                    <div className="modal-overlay" onClick={() => !graphSubmitting && setRemovingRelationshipId(null)}>
                      <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
                        <h2>Delete relationship</h2>
                        <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                          Delete <strong>{relationship.relationshipType}</strong>?
                        </p>
                        <p className="modal-warning-text">
                          This permanently removes the link between the connected objects.
                        </p>
                        <div className="form-actions" style={{ marginTop: 24 }}>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => setRemovingRelationshipId(null)}
                            disabled={graphSubmitting}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="btn btn--danger"
                            onClick={() => void handleDeleteRelationship(relationship.id)}
                            disabled={graphSubmitting}
                          >
                            {graphSubmitting ? "Deleting..." : "Delete relationship"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()
              ) : null}
              {relationshipTypeAttributeModalDraft ? (
                <AttributeDefinitionModal
                  draft={relationshipTypeAttributeModalDraft}
                  saving={graphSubmitting}
                  error={typeAttributeModalError}
                  title={relationshipTypeAttributeModalDraft.id ? "Edit relationship attribute" : "Create relationship attribute"}
                  overlayStyle={{ zIndex: 300 }}
                  onCancel={() => {
                    if (graphSubmitting) return;
                    setRelationshipTypeAttributeModalDraft(null);
                    setTypeAttributeModalError("");
                  }}
                  onSave={saveRelationshipTypeAttributeDraft}
                />
              ) : null}
              {relationshipAttributeEditorDraft ? (
                <AttributeValuesModal
                  draft={relationshipAttributeEditorDraft}
                  rows={relationshipAttributeRows}
                  initialValuesByOwner={Object.fromEntries(
                    relationships.map((relationship) => [
                      relationship.id,
                      relationshipAttributeEditorDraft.id
                        ? valuesForRelationship(relationship)[relationshipAttributeEditorDraft.id] ?? ""
                        : "",
                    ]),
                  )}
                  saving={graphSubmitting}
                  error={relationshipAttributeEditorError}
                  onCancel={() => {
                    if (graphSubmitting) return;
                    setRelationshipAttributeEditorDraft(null);
                    setEditingRelationshipAttributeTypeId(null);
                    setRelationshipAttributeEditorError("");
                  }}
                  onSave={(draft, valuesByOwner) => {
                    void handleSaveRelationshipAttributeDefinition(draft, valuesByOwner);
                  }}
                  emptyStateLabel="Create a relationship first to start assigning attribute values."
                />
              ) : null}
              {relationshipWorkspaceAttributeDraft ? (
                <TypeScopedAttributeModal
                  draft={relationshipWorkspaceAttributeDraft}
                  typeOptions={relationshipWorkspaceAttributeTypeOptions}
                  title="Create relationship attribute"
                  typeLabel="Relationship"
                  saving={graphSubmitting}
                  error={relationshipWorkspaceAttributeError}
                  onCancel={() => {
                    if (graphSubmitting) return;
                    setRelationshipWorkspaceAttributeDraft(null);
                    setRelationshipWorkspaceAttributeError("");
                  }}
                  onSave={(draft) => {
                    void handleCreateRelationshipWorkspaceAttribute(draft);
                  }}
                />
              ) : null}
              {attributeHistoryTarget ? (
                <PostgresAttributeValueHistoryModal
                  target={attributeHistoryTarget}
                  onClose={() => {
                    setAttributeHistoryTarget(null);
                    setActiveObjectAttributeHistoryCell(null);
                    setActiveRelationshipAttributeHistoryCell(null);
                  }}
                />
              ) : null}
            </>
          ) : activeScreen === "free-draw" ? (
            <Suspense fallback={<ViewLoadingFallback />}>
              <PostgresFreeDrawCanvasViewLazy
                projectId={project.id}
                objectTypes={objectTypes}
                objectAttributeDefinitions={objectAttributeDefinitions}
                objects={objects}
                relationships={relationships}
                relationshipTypes={relationshipTypes}
                relationshipAttributeDefinitions={relationshipAttributeDefinitions}
                setRelationships={setRelationships}
                canvasNodes={canvasNodes}
                setCanvasNodes={setCanvasNodes}
                canvasShapes={canvasShapes}
                setCanvasShapes={setCanvasShapes}
                hiddenCanvasRelationshipIds={hiddenCanvasRelationshipIds}
                setHiddenCanvasRelationshipIds={setHiddenCanvasRelationshipIds}
                canvasTool={canvasTool}
                setCanvasTool={setCanvasTool}
                canvasScale={canvasScale}
                setCanvasScale={setCanvasScale}
                canvasOffset={canvasOffset}
                setCanvasOffset={setCanvasOffset}
                canvasRelationshipTypeId={canvasRelationshipTypeId}
                setCanvasRelationshipTypeId={setCanvasRelationshipTypeId}
                freeDrawSaveNotice={freeDrawSaveNotice}
                freeDrawSaving={freeDrawSaving}
                canvasSaveError={canvasSaveError}
                savedCanvasSession={savedCanvasSession}
                onSaveDrawing={async () => {
                  openSaveFreeDrawModal();
                }}
                onCreateObjectAt={openCreateObjectModal}
                onOpenCreateObjectType={() => {
                  setEditingObjectTypeModalId(null);
                  setDraftObjectTypeName("");
                  setDraftObjectTypeDescription("");
                  setDraftObjectTypeShape("rounded");
                  setDraftObjectTypeColor(POSTGRES_OBJECT_TYPE_DEFAULT_COLOR);
                  setDraftObjectTypeFill("filled");
                  setDraftObjectTypeImageStoragePath("");
                  setDraftObjectTypePendingImage(null);
                  setDraftObjectTypeGraphicMode("select");
                  initializeObjectTypeAttributeEditor(null);
                  setObjectTypeModalTab("details");
                  setGraphError("");
                  setCreateObjectTypeOpen(true);
                }}
                onOpenCreateRelationshipType={() => setCreateRelationshipTypeOpen(true)}
                onEditObject={openEditObjectModal}
                onDeleteObject={(objectId) => setRemovingObjectId(objectId)}
                onEditRelationship={openEditRelationshipModal}
                onDeleteRelationship={(relationshipId) => setRemovingRelationshipId(relationshipId)}
                ObjectShapeSwatchComponent={ObjectShapeSwatch}
                getPostgresObjectAppearance={getPostgresObjectAppearance}
                getPostgresObjectSurfaceStyle={getPostgresObjectSurfaceStyle}
                getCanvasNodeDefaultDimensions={getCanvasNodeDefaultDimensions}
                getCanvasNodeRenderedDimensions={getCanvasNodeRenderedDimensions}
                getPostgresRelationshipAppearance={getPostgresRelationshipAppearance}
                getPostgresRelationshipStrokeWidth={getPostgresRelationshipStrokeWidth}
                normalizePostgresObjectTypeColor={normalizePostgresObjectTypeColor}
                normalizePostgresRelationshipLineShape={normalizePostgresRelationshipLineShape}
                normalizePostgresObjectTypeShape={normalizePostgresObjectTypeShape}
                normalizePostgresObjectFill={normalizePostgresObjectFill}
                hexToRgba={hexToRgba}
                translateCanvasShape={translateCanvasShape}
                resizeCanvasBoxShape={resizeCanvasBoxShape}
                isWorldPointInsideCanvasShape={isWorldPointInsideCanvasShape}
                getCanvasShapeBounds={getCanvasShapeBounds}
                getCanvasNodeBoundaryPoint={getCanvasNodeBoundaryPoint}
                renderCanvasSketchShapeElement={renderCanvasSketchShapeElement}
                getCanvasSketchShapeType={getCanvasSketchShapeType}
                getCanvasSketchShapeFill={getCanvasSketchShapeFill}
                getCanvasSketchLineStyle={getCanvasSketchLineStyle}
                getPostgresRelationshipStrokeDasharray={getPostgresRelationshipStrokeDasharray}
                formatPostgresObjectShapeLabel={formatPostgresObjectShapeLabel}
                formatPostgresObjectFillLabel={formatPostgresObjectFillLabel}
                formatPostgresRelationshipLineShapeLabel={formatPostgresRelationshipLineShapeLabel}
                formatPostgresRelationshipLineWeightLabel={formatPostgresRelationshipLineWeightLabel}
                formatPostgresRelationshipArrowheadLabel={formatPostgresRelationshipArrowheadLabel}
                formatCanvasSketchShapeLabel={formatCanvasSketchShapeLabel}
                postgreRelationshipLineShapePickerComponent={PostgresRelationshipLineShapePicker}
                objectTypeShapeOptions={POSTGRES_OBJECT_TYPE_SHAPE_OPTIONS}
                objectFillOptions={POSTGRES_OBJECT_FILL_OPTIONS}
                relationshipLineShapeOptions={POSTGRES_RELATIONSHIP_LINE_SHAPE_OPTIONS}
                relationshipLineWeightOptions={POSTGRES_RELATIONSHIP_LINE_WEIGHT_OPTIONS}
                formatRelationshipTypeConstraintSummary={formatRelationshipTypeConstraintSummary}
              />
            </Suspense>
          ) : activeScreen === "explore" ? (
            <Suspense fallback={<ViewLoadingFallback />}>
              <PostgresExploreCanvasViewLazy
                objectTypes={objectTypes}
                objects={objects}
                relationships={relationships}
                relationshipTypes={relationshipTypes}
                canvasNodes={canvasNodes}
                setCanvasNodes={setCanvasNodes}
                hiddenCanvasRelationshipIds={hiddenCanvasRelationshipIds}
                getObjectAppearance={getPostgresObjectAppearance}
                getObjectSurfaceStyle={getPostgresObjectSurfaceStyle}
                getRelationshipAppearance={getPostgresRelationshipAppearance}
                getRelationshipStrokeWidth={getPostgresRelationshipStrokeWidth}
                getNodeDefaultDimensions={(object, objectTypeRecord) => {
                  const shape = getPostgresObjectAppearance(object, objectTypeRecord).shape;
                  return getCanvasNodeDefaultDimensions(shape);
                }}
                getNodeRenderedDimensions={(object, objectTypeRecord, nodeState) => {
                  const shape = getPostgresObjectAppearance(object, objectTypeRecord).shape;
                  return getCanvasNodeRenderedDimensions(shape, nodeState);
                }}
              />
            </Suspense>
          ) : activeScreen === "construct" ? (
            <div className="view users-view">
              <header className="view-header">
                <div className="users-title-wrap">
                  <h1>Construct</h1>
                  <p className="auth-hint" style={{ margin: "6px 0 0" }}>
                    This canvas mode will focus on assembling structured visual models from research objects and relationships.
                  </p>
                </div>
              </header>
              <div className="empty-state postgres-users-empty-state" style={{ minHeight: 420 }}>
                <p>Construct mode is not wired yet.</p>
              </div>
            </div>
          ) : activeScreen === "view" ? (
            <div className="view users-view">
              <header className="view-header">
                <div className="users-title-wrap">
                  <h1>View</h1>
                  <p className="auth-hint" style={{ margin: "6px 0 0" }}>
                    Browse saved canvases by mode.
                  </p>
                </div>
              </header>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(260px, 320px) minmax(0, 1fr)",
                  gap: 20,
                  alignItems: "start",
                  flex: 1,
                  minHeight: 0,
                }}
              >
                <div className="home-primary-column" style={{ alignSelf: "start", justifyContent: "flex-start" }}>
                  <section
                    className="home-project-card"
                    style={{
                      padding: 0,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: 18,
                        borderBottom: "1px solid rgba(53, 80, 112, 0.08)",
                      }}
                    >
                      <h2 style={{ margin: 0, fontSize: 18 }}>Canvas modes</h2>
                      <span className="home-restricted-value">3</span>
                    </div>

                    <div style={{ maxHeight: 560, overflowY: "auto" }}>
                      <table className="users-table" style={{ tableLayout: "fixed" }}>
                        <thead>
                          <tr>
                            <th className="users-th" style={{ width: "62%" }}>Mode</th>
                            <th className="users-th" style={{ width: "38%" }}>Saved</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            { id: "free_draw", label: "Free Draw" },
                            { id: "explore", label: "Explore" },
                            { id: "construct", label: "Construct" },
                          ].map((canvasKind) => {
                            const count = savedDrawings.filter((drawing) => drawing.canvasKind === canvasKind.id).length;
                            return (
                              <tr
                                key={canvasKind.id}
                                className="users-row"
                                style={{
                                  background:
                                    selectedCanvasViewKind === canvasKind.id ? "rgba(53, 80, 112, 0.10)" : undefined,
                                }}
                              >
                                <td
                                  className="users-td users-td--name"
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => setSelectedCanvasViewKind(canvasKind.id as "free_draw" | "explore" | "construct")}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      event.preventDefault();
                                      setSelectedCanvasViewKind(canvasKind.id as "free_draw" | "explore" | "construct");
                                    }
                                  }}
                                >
                                  {canvasKind.label}
                                </td>
                                <td className="users-td users-td--muted">{count}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>

                <section className="users-content" style={{ alignItems: "stretch", justifyContent: "flex-start", gap: 16 }}>
                  {graphError ? <p className="auth-error">{graphError}</p> : null}
                  {graphLoading ? (
                    <div className="empty-state postgres-users-empty-state">
                      <p>Loading saved canvases...</p>
                    </div>
                  ) : filteredSavedDrawings.length === 0 ? (
                    <div className="empty-state postgres-users-empty-state">
                      <p>No saved {formatCanvasKindLabel(selectedCanvasViewKind).toLowerCase()} canvases yet.</p>
                    </div>
                  ) : (
                    <div className="users-table-wrap postgres-users-table-wrap">
                      <table className="users-table">
                        <thead>
                          <tr>
                            <th className="users-th" style={{ width: "30%" }}>Name</th>
                            <th className="users-th" style={{ width: "16%" }}>Mode</th>
                            <th className="users-th" style={{ width: "18%" }}>Created</th>
                            <th className="users-th" style={{ width: "18%" }}>Updated</th>
                            <th className="users-th" style={{ width: "18%" }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredSavedDrawings.map((drawing) => (
                            <tr key={drawing.id} className="users-row">
                              <td className="users-td users-td--name">{drawing.name}</td>
                              <td className="users-td users-td--muted">{formatCanvasKindLabel(drawing.canvasKind)}</td>
                              <td className="users-td users-td--muted">
                                {formatCurrentDateTime(drawing.createdAt, {
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  second: "2-digit",
                                })}
                              </td>
                              <td className="users-td users-td--muted">
                                {formatCurrentDateTime(drawing.updatedAt, {
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  second: "2-digit",
                                })}
                              </td>
                              <td className="users-td">
                                <button
                                  type="button"
                                  className="btn btn--ghost"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    const rect = event.currentTarget.getBoundingClientRect();
                                    setOpenSavedDrawingActionsMenu((current) =>
                                      current?.id === drawing.id
                                        ? null
                                        : {
                                            id: drawing.id,
                                            left: Math.min(rect.right - 150, window.innerWidth - 170),
                                            top: Math.min(rect.bottom + 4, window.innerHeight - 128),
                                          },
                                    );
                                  }}
                                >
                                  Actions
                                </button>
                                {openSavedDrawingActionsMenu?.id === drawing.id ? (
                                  <div
                                    role="menu"
                                    style={{
                                      position: "fixed",
                                      left: openSavedDrawingActionsMenu.left,
                                      top: openSavedDrawingActionsMenu.top,
                                      zIndex: 1200,
                                      minWidth: 164,
                                      padding: 6,
                                      borderRadius: 10,
                                      border: "1px solid rgba(53, 80, 112, 0.16)",
                                      background: "rgba(255, 255, 255, 0.99)",
                                      boxShadow: "0 16px 32px rgba(15, 23, 42, 0.18)",
                                    }}
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    <button
                                      type="button"
                                      role="menuitem"
                                      style={{
                                        display: "block",
                                        width: "100%",
                                        padding: "8px 10px",
                                        border: "none",
                                        background: "transparent",
                                        borderRadius: 8,
                                        textAlign: "left",
                                        fontSize: 14,
                                        fontWeight: 500,
                                        color: "#1f2933",
                                        cursor: "pointer",
                                      }}
                                      onClick={() => {
                                        setOpenSavedDrawingActionsMenu(null);
                                        void openSavedDrawingSession(drawing.id, "view");
                                      }}
                                    >
                                      View
                                    </button>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      style={{
                                        display: "block",
                                        width: "100%",
                                        padding: "8px 10px",
                                        border: "none",
                                        background: "transparent",
                                        borderRadius: 8,
                                        textAlign: "left",
                                        fontSize: 14,
                                        fontWeight: 500,
                                        color: "#1f2933",
                                        cursor: "pointer",
                                      }}
                                      onClick={() => {
                                        setOpenSavedDrawingActionsMenu(null);
                                        void openSavedDrawingSession(drawing.id, "edit");
                                      }}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      style={{
                                        display: "block",
                                        width: "100%",
                                        padding: "8px 10px",
                                        border: "none",
                                        background: "transparent",
                                        borderRadius: 8,
                                        textAlign: "left",
                                        fontSize: 14,
                                        fontWeight: 500,
                                        color: "#1f2933",
                                        cursor: "pointer",
                                      }}
                                      onClick={() => {
                                        setExportingSavedDrawingId(drawing.id);
                                        setOpenSavedDrawingActionsMenu(null);
                                      }}
                                    >
                                      Export
                                    </button>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      style={{
                                        display: "block",
                                        width: "100%",
                                        padding: "8px 10px",
                                        border: "none",
                                        background: "transparent",
                                        borderRadius: 8,
                                        textAlign: "left",
                                        fontSize: 14,
                                        fontWeight: 500,
                                        color: "#b42318",
                                        cursor: "pointer",
                                      }}
                                      onClick={() => {
                                        setRemovingSavedDrawingId(drawing.id);
                                        setOpenSavedDrawingActionsMenu(null);
                                      }}
                                    >
                                      Delete
                                    </button>
                                  </div>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </div>
            </div>
          ) : activeScreen === "app-settings" ? (
            <Suspense fallback={<ViewLoadingFallback />}>
              <PostgresAppSettingsViewLazy authSession={authSession} />
            </Suspense>
          ) : activeScreen === "project-settings" ? (
            <Suspense fallback={<ViewLoadingFallback />}>
              <PostgresProjectSettingsViewLazy
                project={project}
                canManageProject={canManageProjectSettings}
                memberCount={users.length}
                ownerCount={ownerCount}
                objectCount={objects.length}
                relationshipCount={relationships.length}
                onProjectUpdated={onProjectUpdated}
                onProjectDeleted={onProjectDeleted}
              />
            </Suspense>
          ) : (
            <Suspense fallback={<ViewLoadingFallback />}>
              <PostgresUserSettingsViewLazy
                authSession={authSession}
                onAuthSessionUpdated={onAuthSessionUpdated}
                onAuthSessionInvalidated={onAuthSessionInvalidated}
              />
            </Suspense>
          )}
          {createRelationshipTypeOpen ? (
            renderRelationshipTypeModal({
              title: "Add relationship type",
              submitLabel: "Add relationship type",
              ariaLabel: "Add relationship type tabs",
              onClose: () => setCreateRelationshipTypeOpen(false),
              onSubmit: handleCreateRelationshipType,
            })
          ) : null}
          {saveFreeDrawModalOpen ? (
            <div className="modal-overlay" onClick={() => !freeDrawSaving && setSaveFreeDrawModalOpen(false)}>
              <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
                <h2>Save canvas</h2>
                <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                  Choose a name for this saved canvas.
                </p>
                <form
                  className="form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleSaveFreeDrawCanvas();
                  }}
                >
                  <label className="form-field">
                    <span>Canvas name</span>
                    <input
                      className="form-input"
                      value={saveFreeDrawName}
                      onChange={(event) => setSaveFreeDrawName(event.target.value)}
                      placeholder="Enter canvas name"
                      autoFocus
                      disabled={freeDrawSaving}
                    />
                  </label>
                  <div className="form-actions" style={{ marginTop: 24 }}>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setSaveFreeDrawModalOpen(false)}
                      disabled={freeDrawSaving}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn btn--primary"
                      disabled={freeDrawSaving}
                    >
                      {freeDrawSaving ? "Saving..." : "Save canvas"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}
          {exportingSavedDrawingId ? (
            (() => {
              const drawing = savedDrawings.find((entry) => entry.id === exportingSavedDrawingId);
              if (!drawing) return null;
              return (
                <div className="modal-overlay" onClick={() => !savedDrawingExportBusyFormat && setExportingSavedDrawingId(null)}>
                  <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
                    <h2>Export saved canvas</h2>
                    <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                      Export <strong>{drawing.name}</strong>.
                    </p>
                    <div className="form" style={{ gap: 12 }}>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void handleExportSavedDrawing("png")}
                        disabled={savedDrawingExportBusyFormat !== null}
                      >
                        {savedDrawingExportBusyFormat === "png" ? "Exporting PNG..." : "Export as PNG"}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void handleExportSavedDrawing("pdf")}
                        disabled={savedDrawingExportBusyFormat !== null}
                      >
                        {savedDrawingExportBusyFormat === "pdf" ? "Exporting PDF..." : "Export as PDF"}
                      </button>
                    </div>
                    <div className="form-actions" style={{ marginTop: 24 }}>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setExportingSavedDrawingId(null)}
                        disabled={savedDrawingExportBusyFormat !== null}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()
          ) : null}
          {removingSavedDrawingId ? (
            (() => {
              const drawing = savedDrawings.find((entry) => entry.id === removingSavedDrawingId);
              if (!drawing) return null;
              return (
                <div className="modal-overlay" onClick={() => !graphSubmitting && setRemovingSavedDrawingId(null)}>
                  <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
                    <h2>Delete saved canvas</h2>
                    <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                      Delete <strong>{drawing.name}</strong>?
                    </p>
                    <p className="modal-warning-text">
                      This permanently removes the saved canvas from this project.
                    </p>
                    <div className="form-actions" style={{ marginTop: 24 }}>
                      <button type="button" className="btn" onClick={() => setRemovingSavedDrawingId(null)} disabled={graphSubmitting}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn--danger"
                        onClick={() => void handleDeleteSavedDrawing(drawing.id)}
                        disabled={graphSubmitting}
                      >
                        {graphSubmitting ? "Deleting..." : "Delete saved canvas"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()
          ) : null}
          {imageCropDraft ? (
            <PostgresImageCropModal
              draft={imageCropDraft}
              onDraftChange={setImageCropDraft}
              onCancel={handleCancelPostgresImageCropChoice}
              onUseFullImage={handleUseFullPostgresImage}
              onUseCrop={() => void handleUseCroppedPostgresImage()}
              busy={imageCropSubmitting}
            />
          ) : null}
          {createObjectOpen ? (
            renderObjectModal({
              title: "Create object",
              ariaLabel: "Create object tabs",
              tab: createObjectModalTab,
              setTab: setCreateObjectModalTab,
              submitLabel: "Add object",
              objectTypeId,
              titleValue: objectTitle,
              descriptionValue: objectDescription,
              colorOverride: objectColorOverride,
              shapeOverride: objectShapeOverride,
              fillOverride: objectFillOverride,
              imageStoragePath: objectImageStoragePath,
              imagePreviewUrl: draftObjectPendingImage?.previewUrl ?? "",
              graphicMode: objectGraphicMode,
              selectedType: selectedCreateObjectType,
              attributeDefinitions: objectAttributeDefinitionsForCreateType,
              attributeValues: objectAttributeValues,
              onClose: closeCreateObjectModal,
              onSubmit: handleCreateObject,
              setObjectTypeId,
              setTitleValue: setObjectTitle,
              setDescriptionValue: setObjectDescription,
              setColorOverride: setObjectColorOverride,
              setShapeOverride: setObjectShapeOverride,
              setFillOverride: setObjectFillOverride,
              setImageStoragePath: setObjectImageStoragePath,
              setGraphicMode: setObjectGraphicMode,
              setAttributeValues: setObjectAttributeValues,
              onImportImage: () => void handlePickPendingObjectImage(),
              onRemoveImage: handleRemovePendingObjectImage,
              onClearPendingImage: handleRemovePendingObjectImage,
            })
          ) : null}
          {editingObjectId ? (
            renderObjectModal({
              title: "Edit object",
              ariaLabel: "Edit object tabs",
              tab: editObjectModalTab,
              setTab: setEditObjectModalTab,
              submitLabel: "Save changes",
              objectTypeId: editingObjectTypeId,
              titleValue: editingObjectTitle,
              descriptionValue: editingObjectDescription,
              colorOverride: editingObjectColorOverride,
              shapeOverride: editingObjectShapeOverride,
              fillOverride: editingObjectFillOverride,
              imageStoragePath: editingObjectImageStoragePath,
              graphicMode: editingObjectGraphicMode,
              selectedType: selectedEditObjectType,
              attributeDefinitions: objectAttributeDefinitionsForEditingType,
              attributeValues: editingObjectAttributeValues,
              onClose: () => setEditingObjectId(null),
              onSubmit: handleSaveObject,
              setObjectTypeId: setEditingObjectTypeId,
              setTitleValue: setEditingObjectTitle,
              setDescriptionValue: setEditingObjectDescription,
              setColorOverride: setEditingObjectColorOverride,
              setShapeOverride: setEditingObjectShapeOverride,
              setFillOverride: setEditingObjectFillOverride,
              setImageStoragePath: setEditingObjectImageStoragePath,
              setGraphicMode: setEditingObjectGraphicMode,
              setAttributeValues: setEditingObjectAttributeValues,
              onImportImage: () => void handleImportEditingObjectImage(editingObjectId),
              onRemoveImage: () => void handleRemoveEditingObjectImage(editingObjectId),
            })
          ) : null}
          {createRelationshipOpen ? (
            <PostgresRelationshipModal
              title="Create relationship"
              ariaLabel="Create relationship tabs"
              tab={createRelationshipModalTab}
              setTab={setCreateRelationshipModalTab}
              submitLabel="Add relationship"
              relationshipTypes={relationshipTypes}
              relationshipTypeId={relationshipTypeId}
              setRelationshipTypeId={setRelationshipTypeId}
              selectedType={selectedRelationshipType}
              fromEndpointKey={fromObjectId}
              setFromEndpointKey={setFromObjectId}
              toEndpointKey={toObjectId}
              setToEndpointKey={setToObjectId}
              availableFromEndpoints={availableFromEndpointOptions}
              availableToEndpoints={availableToEndpointOptions}
              description={relationshipDescription}
              setDescription={setRelationshipDescription}
              lineShapeOverride={relationshipLineShapeOverride}
              setLineShapeOverride={setRelationshipLineShapeOverride}
              lineWeightOverride={relationshipLineWeightOverride}
              setLineWeightOverride={setRelationshipLineWeightOverride}
              arrowheadOverride={relationshipArrowheadOverride}
              setArrowheadOverride={setRelationshipArrowheadOverride}
              colorOverride={relationshipColorOverride}
              setColorOverride={setRelationshipColorOverride}
              attributeDefinitions={relationshipAttributeDefinitionsForCreateType}
              attributeValues={relationshipAttributeValues}
              setAttributeValues={setRelationshipAttributeValues}
              submitting={graphSubmitting}
              submitDisabled={!fromObjectId || !toObjectId}
              onClose={closeCreateRelationshipModal}
              onSubmit={handleCreateRelationship}
              onNewRelationshipType={openCreateRelationshipTypeModal}
            />
          ) : null}
          {activeScreen !== "objects" && removingObjectId ? (
            (() => {
              const object = objects.find((entry) => entry.id === removingObjectId);
              if (!object) return null;
              return (
                <div className="modal-overlay" onClick={() => !graphSubmitting && setRemovingObjectId(null)}>
                  <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
                    <h2>Delete object</h2>
                    <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                      Delete <strong>{object.title}</strong>?
                    </p>
                    <p className="modal-warning-text">
                      This permanently removes the object and any relationships connected to it.
                    </p>
                    <div className="form-actions" style={{ marginTop: 24 }}>
                      <button type="button" className="btn" onClick={() => setRemovingObjectId(null)} disabled={graphSubmitting}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn--danger"
                        onClick={() => void handleDeleteObject(object.id)}
                        disabled={graphSubmitting}
                      >
                        {graphSubmitting ? "Deleting..." : "Delete object"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()
          ) : null}
          {editingRelationshipId ? (
            renderRelationshipModal({
              title: "Edit relationship",
              ariaLabel: "Edit relationship tabs",
              tab: editRelationshipModalTab,
              setTab: setEditRelationshipModalTab,
              submitLabel: "Save changes",
              fromObjectId: editingRelationshipFromObjectId,
              toObjectId: editingRelationshipToObjectId,
              relationshipTypeId: editingRelationshipTypeId,
              description: editingRelationshipDescription,
              lineShapeOverride: editingRelationshipLineShapeOverride,
              lineWeightOverride: editingRelationshipLineWeightOverride,
              arrowheadOverride: editingRelationshipArrowheadOverride,
              colorOverride: editingRelationshipColorOverride,
              availableFromObjects: availableEditingFromObjects,
              availableToObjects: availableEditingToObjects,
              selectedType: editingRelationshipTypeRecord,
              attributeDefinitions: relationshipAttributeDefinitionsForEditingType,
              attributeValues: editingRelationshipAttributeValues,
              onClose: () => setEditingRelationshipId(null),
              onSubmit: (event) => {
                void handleSaveRelationship(event);
              },
              setFromObjectId: setEditingRelationshipFromObjectId,
              setToObjectId: setEditingRelationshipToObjectId,
              setRelationshipTypeId: setEditingRelationshipTypeId,
              setDescription: setEditingRelationshipDescription,
              setLineShapeOverride: setEditingRelationshipLineShapeOverride,
              setLineWeightOverride: setEditingRelationshipLineWeightOverride,
              setArrowheadOverride: setEditingRelationshipArrowheadOverride,
              setColorOverride: setEditingRelationshipColorOverride,
              setAttributeValues: setEditingRelationshipAttributeValues,
            })
          ) : null}
          {(activeScreen !== "relationships" || selectedRelationshipDetails) && removingRelationshipId ? (
            (() => {
              const relationship = relationships.find((entry) => entry.id === removingRelationshipId);
              if (!relationship) return null;
              return (
                <div className="modal-overlay" onClick={() => !graphSubmitting && setRemovingRelationshipId(null)}>
                  <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
                    <h2>Delete relationship</h2>
                    <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                      Delete <strong>{relationship.relationshipType}</strong>?
                    </p>
                    <p className="modal-warning-text">
                      This permanently removes the link between the connected objects.
                    </p>
                    <div className="form-actions" style={{ marginTop: 24 }}>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setRemovingRelationshipId(null)}
                        disabled={graphSubmitting}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn--danger"
                        onClick={() => void handleDeleteRelationship(relationship.id)}
                        disabled={graphSubmitting}
                      >
                        {graphSubmitting ? "Deleting..." : "Delete relationship"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()
          ) : null}
        </div>
      </main>
    </div>
  );
}

function PostgresSidebar({
  activeScreen,
  activeProject,
  authSession,
  onShowProjects,
  onShowProjectHome,
  onShowProjectUsers,
  onShowProjectSources,
  onShowProjectAnnotations,
  onShowProjectCodebook,
  onShowProjectCodeText,
  onShowProjectMemos,
  onShowProjectReports,
  onShowProjectLog,
  onShowProjectObjects,
  onShowProjectRelationships,
  onShowAiAssistHome,
  onShowAiAssistChat,
  onShowAiAssistedCoding,
  onShowAiAnalyze,
  onShowAiAssistSourceAttributes,
  onShowAiAssistProcessDocuments,
  onShowFreeDraw,
  onShowExplore,
  onShowConstruct,
  onShowCanvasView,
  onShowAppSettings,
  onShowProjectSettings,
  onShowUserSettings,
  onBackToGate,
  onSignOut,
}: {
  activeScreen: "projects" | PostgresProjectScreen;
  activeProject: PostgresProject | null;
  authSession: PostgresAuthSession;
  onShowProjects?: () => void;
  onShowProjectHome?: () => void;
  onShowProjectUsers?: () => void;
  onShowProjectSources?: () => void;
  onShowProjectAnnotations?: () => void;
  onShowProjectCodebook?: () => void;
  onShowProjectCodeText?: () => void;
  onShowProjectMemos?: () => void;
  onShowProjectReports?: () => void;
  onShowProjectLog?: () => void;
  onShowProjectObjects?: () => void;
  onShowProjectRelationships?: () => void;
  onShowAiAssistHome?: () => void;
  onShowAiAssistChat?: () => void;
  onShowAiAssistedCoding?: () => void;
  onShowAiAnalyze?: () => void;
  onShowAiAssistSourceAttributes?: () => void;
  onShowAiAssistProcessDocuments?: () => void;
  onShowFreeDraw?: () => void;
  onShowExplore?: () => void;
  onShowConstruct?: () => void;
  onShowCanvasView?: () => void;
  onShowAppSettings?: () => void;
  onShowProjectSettings?: () => void;
  onShowUserSettings?: () => void;
  onBackToGate: () => void;
  onSignOut: () => Promise<void>;
}) {
  const [collapsedSidebarSections, setCollapsedSidebarSections] = useState<Set<string>>(() => new Set());
  const toggleSidebarSection = (sectionId: string) => {
    setCollapsedSidebarSections((current) => {
      const next = new Set(current);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };
  const projectItems = [
    { id: "home", label: "Home", disabled: !activeProject, onClick: onShowProjectHome },
    { id: "users", label: "Users", disabled: !activeProject, onClick: onShowProjectUsers },
    { id: "sources", label: "Sources", disabled: !activeProject, onClick: onShowProjectSources },
    { id: "objects", label: "Objects", disabled: !activeProject, onClick: onShowProjectObjects },
    { id: "relationships", label: "Relationships", disabled: !activeProject, onClick: onShowProjectRelationships },
    { id: "codebook", label: "Codebook", disabled: !activeProject, onClick: onShowProjectCodebook },
    { id: "annotations", label: "Annotations", disabled: !activeProject, onClick: onShowProjectAnnotations },
    { id: "project-log", label: "Log", disabled: !activeProject, onClick: onShowProjectLog },
  ];
  const canvasItems = [
    { id: "free-draw", label: "Free Draw", disabled: !activeProject, onClick: onShowFreeDraw },
    { id: "explore", label: "Explore", disabled: !activeProject, onClick: onShowExplore },
    { id: "construct", label: "Construct", disabled: !activeProject, onClick: onShowConstruct },
    { id: "view", label: "View", disabled: !activeProject, onClick: onShowCanvasView },
  ];
  const analysisItems = [
    { id: "code-text", label: "Code Sources", disabled: !activeProject, onClick: onShowProjectCodeText },
    { id: "memos", label: "Memos", disabled: !activeProject, onClick: onShowProjectMemos },
    { id: "reports", label: "Reports", disabled: !activeProject, onClick: onShowProjectReports },
  ];
  const aiAssistItems = [
    { id: "ai-assist", label: "Home", disabled: !activeProject, onClick: onShowAiAssistHome },
    { id: "ai-assist-chat", label: "Chat", disabled: !activeProject, onClick: onShowAiAssistChat },
    { id: "ai-assisted-coding", label: "Assisted Coding", disabled: !activeProject, onClick: onShowAiAssistedCoding },
    { id: "ai-analyze", label: "Analyze Codes", disabled: !activeProject, onClick: onShowAiAnalyze },
    { id: "ai-assist-source-attributes", label: "Attributes", disabled: !activeProject, onClick: onShowAiAssistSourceAttributes },
    { id: "ai-assist-process-documents", label: "Transcripts", disabled: !activeProject, onClick: onShowAiAssistProcessDocuments },
  ];
  const settingsItems = [
    { id: "app-settings", label: "App Settings", disabled: false, onClick: onShowAppSettings },
    { id: "project-settings", label: "Project Settings", disabled: !activeProject, onClick: onShowProjectSettings },
    { id: "user-settings", label: "User Settings", disabled: false, onClick: onShowUserSettings },
    { id: "projects", label: "Projects", disabled: false, onClick: onShowProjects },
    { id: "experiment", label: "Back to Gate", disabled: false, onClick: onBackToGate },
    { id: "sign-out", label: "Sign Out", disabled: false, onClick: () => void onSignOut() },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src={sidebarLogo} alt="Kanqual" className="brand-logo" />
        <div className="brand-collapsed-lockup" aria-hidden="true">
          <img src={sidebarMarkLogo} alt="" className="brand-collapsed-logo" />
          <span className="brand-collapsed-title">Kanqual</span>
        </div>
      </div>

      {activeProject ? (
        <div className="sidebar-project-badge">
          <span className="project-badge-label">PostgreSQL Project</span>
          <div className="project-badge-row">
            <span className="project-badge-name">
              {activeProject.name}
            </span>
          </div>
        </div>
      ) : (
        <button type="button" className="sidebar-project-badge sidebar-project-badge--empty" onClick={onShowProjects}>
          <span className="project-badge-label">PostgreSQL Project</span>
          <span className="project-badge-empty-text">Open Project</span>
        </button>
      )}

      <nav className="sidebar-nav">
        <div className="sidebar-section">
          <button
            type="button"
            className="sidebar-section-header"
            aria-expanded={!collapsedSidebarSections.has("project")}
            onClick={() => toggleSidebarSection("project")}
          >
            <span>Project</span>
            <span className="sidebar-section-chevron">
              {collapsedSidebarSections.has("project") ? "\u25b8" : "\u25be"}
            </span>
          </button>
          <div
            className={`sidebar-section-items ${collapsedSidebarSections.has("project") ? "sidebar-section-items--collapsed" : ""}`}
          >
            {projectItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${activeScreen === item.id ? "nav-item--active" : ""}`}
                onClick={() => item.onClick?.()}
                disabled={item.disabled}
                title={undefined}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <button
            type="button"
            className="sidebar-section-header"
            aria-expanded={!collapsedSidebarSections.has("analysis")}
            onClick={() => toggleSidebarSection("analysis")}
          >
            <span>Analysis</span>
            <span className="sidebar-section-chevron">
              {collapsedSidebarSections.has("analysis") ? "\u25b8" : "\u25be"}
            </span>
          </button>
          <div
            className={`sidebar-section-items ${collapsedSidebarSections.has("analysis") ? "sidebar-section-items--collapsed" : ""}`}
          >
            {analysisItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${activeScreen === item.id ? "nav-item--active" : ""}`}
                onClick={() => item.onClick?.()}
                disabled={item.disabled}
                title={undefined}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <button
            type="button"
            className="sidebar-section-header"
            aria-expanded={!collapsedSidebarSections.has("ai-assist")}
            onClick={() => toggleSidebarSection("ai-assist")}
          >
            <span>AI Assist</span>
            <span className="sidebar-section-chevron">
              {collapsedSidebarSections.has("ai-assist") ? "\u25b8" : "\u25be"}
            </span>
          </button>
          <div
            className={`sidebar-section-items ${collapsedSidebarSections.has("ai-assist") ? "sidebar-section-items--collapsed" : ""}`}
          >
            {aiAssistItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${activeScreen === item.id ? "nav-item--active" : ""}`}
                onClick={() => item.onClick?.()}
                disabled={item.disabled}
                title={item.disabled ? "Open a PostgreSQL project first." : undefined}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <button
            type="button"
            className="sidebar-section-header"
            aria-expanded={!collapsedSidebarSections.has("settings")}
            onClick={() => toggleSidebarSection("settings")}
          >
            <span>Settings</span>
            <span className="sidebar-section-chevron">
              {collapsedSidebarSections.has("settings") ? "\u25b8" : "\u25be"}
            </span>
          </button>
          <div
            className={`sidebar-section-items ${collapsedSidebarSections.has("settings") ? "sidebar-section-items--collapsed" : ""}`}
          >
            {settingsItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${activeScreen === item.id ? "nav-item--active" : ""}`}
                onClick={() => item.onClick?.()}
                disabled={item.disabled}
                title={item.disabled ? "Open a PostgreSQL project first." : undefined}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="sidebar-section">
          <button
            type="button"
            className="sidebar-section-header"
            aria-expanded={!collapsedSidebarSections.has("canvas")}
            onClick={() => toggleSidebarSection("canvas")}
          >
            <span>Canvas</span>
            <span className="sidebar-section-chevron">
              {collapsedSidebarSections.has("canvas") ? "\u25b8" : "\u25be"}
            </span>
          </button>
          <div
            className={`sidebar-section-items ${collapsedSidebarSections.has("canvas") ? "sidebar-section-items--collapsed" : ""}`}
          >
            {canvasItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${activeScreen === item.id ? "nav-item--active" : ""}`}
                onClick={() => item.onClick?.()}
                disabled={item.disabled}
                title={item.disabled ? "Open a PostgreSQL project first." : undefined}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <div className="sidebar-user">
        <div className="sidebar-user-info">
          <div className="sidebar-user-name">
            {authSession.user.name}
          </div>
          <div className="sidebar-user-email">{authSession.user.email}</div>
        </div>
      </div>
    </aside>
  );
}

function ViewLoadingFallback() {
  return (
    <div className="view-loading-state" role="status" aria-live="polite">
      <div className="view-loading-card">
        <strong>Loading view</strong>
        <span>Please wait while Kanqual opens this workspace.</span>
      </div>
    </div>
  );
}
