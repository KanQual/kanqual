import {
  type ComponentType,
  type Dispatch,
  type SetStateAction,
  Suspense,
  lazy,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
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
import { PlusIcon } from "../components/AppIcons";
import {
  EditableAttributesMatrix,
  type EditableAttributeMatrixValues,
} from "../components/EditableAttributesMatrix";
import { SettingsModal } from "../components/SettingsModal";
import { inferUploadMediaType, SourceEditorModal, SourceImportModal, type SourceRow } from "./Postgres_Sources_View";
import { NewCodeModal, type CodeRow } from "./Project_Codebook_View";
import { formatCurrentDateTime } from "../i18n/formatters";
import { readAppSettings } from "../lib/appSettings";
import { createMediaWaveformCache, serializeMediaWaveformCache } from "../lib/mediaWaveform";
import { createMediaVideoFrameIndexCache, serializeMediaVideoFrameIndexCache } from "../lib/mediaVideoFrameIndex";
import {
  createPostgresCode,
  createPostgresSource,
  createPostgresObjectAttributeDefinition,
  createPostgresRelationshipAttributeDefinition,
  deletePostgresCode,
  deletePostgresObject,
  deletePostgresObjectType,
  deletePostgresRelationship,
  deletePostgresRelationshipType,
  deletePostgresSavedDrawing,
  deletePostgresSource,
  getPostgresProjectCanvasState,
  getPostgresProjectAiAssistRuntimeStatus,
  getPostgresProjectAiAssistSettings,
  getPostgresProjectDocumentImportSettings,
  getPostgresSavedDrawing,
  getPostgresStatus,
  importPostgresSourceFile,
  importPostgresObjectImage,
  importPostgresObjectTypeImage,
  listPostgresObjects,
  listPostgresObjectAttributeDefinitions,
  listPostgresObjectTypes,
  listPostgresAnnotationSummaries,
  listPostgresCodes,
  listPostgresMemos,
  listPostgresProjectUsers,
  listPostgresRelationshipAttributeDefinitions,
  listPostgresRelationships,
  listPostgresRelationshipTypes,
  listPostgresReports,
  listPostgresSavedDrawingSummaries,
  listPostgresSourceAttributeDefinitions,
  listPostgresSourceAttributeValues,
  listPostgresSources,
  listPostgresSourceTypeSettings,
  savePostgresObject,
  savePostgresObjectType,
  savePostgresProjectCanvasState,
  savePostgresRelationship,
  savePostgresRelationshipType,
  savePostgresSavedDrawing,
  savePostgresSourceAttribute,
  removePostgresObjectImage,
  removePostgresObjectTypeImage,
  updatePostgresCode,
  updatePostgresSource,
  updatePostgresRelationshipAttributeDefinition,
  type PostgresAuthSession,
  type PostgresAnnotationSummary,
  type PostgresCanvasDisplayShape,
  type PostgresCanvasNodeState,
  type PostgresCanvasPoint,
  type PostgresCanvasShape,
  type PostgresCode,
  type PostgresObject,
  type PostgresObjectAttributeDefinition,
  type PostgresObjectType,
  type PostgresProject,
  type PostgresProjectChangeEvent,
  type PostgresInstallationSettings,
  type PostgresProjectUser,
  type PostgresRelationship,
  type PostgresRelationshipAttributeDefinition,
  type PostgresRelationshipType,
  type PostgresSavedDrawing,
  type PostgresSavedDrawingSummary,
  type PostgresSource,
  type PostgresSourceAttributeDefinition,
  type PostgresSourceAttributeValue,
  type PostgresSourceTypeSetting,
  POSTGRES_PROJECT_CHANGED_EVENT,
} from "../lib/postgres";
import type {
  ProjectEmbeddingBuildStatus,
  ProjectEmbeddingStoreStatus,
} from "../lib/projectEmbeddings";
import { POSTGRES_SOURCE_DOCUMENT_SILHOUETTE_POLYGON } from "../lib/postgresCanvasGraph";
import {
  AttributeValuesModal,
  type SharedAttributeDraft,
} from "../components/AttributeValuesModal";
import {
  PostgresAttributeValueHistoryModal,
  type PostgresAttributeValueHistoryTarget,
} from "../components/PostgresAttributeValueHistoryModal";
import { AttributeDefinitionModal } from "../components/AttributeDefinitionModal";
import { LoadingCard } from "../components/LoadingCard";
import { usePostgresAutomaticProjectSnapshots } from "../hooks/usePostgresAutomaticProjectSnapshots";
import { OPEN_PROJECT_SETTINGS_MODAL_EVENT } from "../lib/projectBackupBanner";
import {
  PostgresRelationshipModal,
  type PostgresRelationshipEndpointOption as SharedPostgresRelationshipEndpointOption,
} from "../components/PostgresRelationshipModal";
import { PostgresSidebar } from "./Postgres_Sidebar";
import type {
  PostgresSidebarAiStatus,
  PostgresSidebarCollaborationStatus,
  PostgresSidebarNetworkMode,
} from "./Postgres_Sidebar";
import type { PostgresMemoDraftTarget } from "./Postgres_Project_Memos_View";
import { PostgresProjectHomeDetailsView } from "./Postgres_Project_Home_Details_View";
import { PostgresProjectHomeTimelineView } from "./Postgres_Project_Home_Timeline_View";
import { PostgresProjectHomeGraphView } from "./Postgres_Project_Home_Graph_View";

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
  installationSettings?: PostgresInstallationSettings | null;
  onBack: () => void;
  onProjectUpdated: (project: PostgresProject) => void;
  onProjectDeleted: (projectId: string) => void;
  onProjectOpened?: (project: PostgresProject) => void | Promise<void>;
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
type PostgresRelationshipLineShape =
  | "solid"
  | "dashed"
  | "long_dashed"
  | "short_dashed"
  | "dotted"
  | "loose_dotted"
  | "dash_dot"
  | "dash_dot_dot";
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
type PostgresUserRoleSortCol = "role" | "count";
type PostgresRelationshipTypeSortCol = "relationshipType" | "count";
type PostgresHomeCanvasSection = "sources" | "objects" | "relationships" | "codes" | "annotations";
type PostgresHomeCanvasSizeSectionKey = "sources" | "objects" | "codes";
type PostgresHomeCanvasContextKind = "background" | "source" | "object" | "relationship" | "code" | "annotation";
type PostgresHomeCanvasContextMenuState = {
  kind: PostgresHomeCanvasContextKind;
  id: string | null;
  x: number;
  y: number;
  canvasPosition: PostgresCanvasPoint | null;
};
type PostgresProjectHomeTab = "details" | "graph" | "timeline";
type PostgresHomeCanvasDeleteTarget = {
  kind: "source" | "object" | "relationship" | "code";
  id: string;
  label: string;
};
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
  { value: "long_dashed", label: "Long dash" },
  { value: "short_dashed", label: "Short dash" },
  { value: "dotted", label: "Dotted" },
  { value: "loose_dotted", label: "Loose dots" },
  { value: "dash_dot", label: "Dash-dot" },
  { value: "dash_dot_dot", label: "Dash-dot-dot" },
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
  const normalizedMarkup = svgMarkup.replace("<svg ", '<svg width="100" height="100" ');
  return `data:image/svg+xml;utf8,${encodeURIComponent(normalizedMarkup)}`;
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

function resolvePostgresObjectOutlineColor(
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

function resolvePostgresObjectFill(
  object: Pick<PostgresObject, "fillOverride">,
  objectTypeRecord: Pick<PostgresObjectType, "fill"> | null,
): PostgresObjectFill {
  return normalizePostgresObjectFill(object.fillOverride || objectTypeRecord?.fill || "");
}

function getPostgresObjectAppearance(
  object: Pick<PostgresObject, "shapeOverride" | "colorOverride" | "outlineColorOverride" | "fillOverride" | "imageStoragePath">,
  objectTypeRecord: Pick<PostgresObjectType, "shape" | "color" | "outlineColor" | "fill" | "systemKey" | "imageStoragePath"> | null,
): {
  shape: PostgresObjectTypeShape;
  color: string;
  outlineColor: string;
  fill: PostgresObjectFill;
  imageStoragePath: string;
  sourceVisualKey: PostgresSourceObjectVisualKey | null;
  sourceImage: string;
  sourceSilhouettePolygon: string;
  hasShapeOverride: boolean;
  hasColorOverride: boolean;
  hasOutlineColorOverride: boolean;
  hasFillOverride: boolean;
} {
  const sourceVisualKey = getPostgresSourceObjectVisualKey(objectTypeRecord?.systemKey);
  return {
    shape: resolvePostgresObjectShape(object, objectTypeRecord),
    color: resolvePostgresObjectColor(object, objectTypeRecord),
    outlineColor: resolvePostgresObjectOutlineColor(object, objectTypeRecord),
    fill: resolvePostgresObjectFill(object, objectTypeRecord),
    imageStoragePath: object.imageStoragePath || objectTypeRecord?.imageStoragePath || "",
    sourceVisualKey,
    sourceImage: sourceVisualKey ? POSTGRES_SOURCE_OBJECT_SHAPE_ASSET_URLS[sourceVisualKey] : "",
    sourceSilhouettePolygon: sourceVisualKey ? POSTGRES_SOURCE_DOCUMENT_SILHOUETTE_POLYGON : "",
    hasShapeOverride: !!object.shapeOverride.trim(),
    hasColorOverride: !!object.colorOverride.trim(),
    hasOutlineColorOverride: !!object.outlineColorOverride.trim(),
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
  previewOutlineColor?: string;
  previewFill?: PostgresObjectFill;
  allowInherit?: boolean;
  inheritLabel?: string;
}) {
  const {
    value,
    onChange,
    previewColor,
    previewOutlineColor = previewColor,
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
              outlineColor={previewOutlineColor}
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
  previewOutlineColor?: string;
  previewShape?: PostgresObjectTypeShape;
  allowInherit?: boolean;
  inheritLabel?: string;
}) {
  const {
    value,
    onChange,
    previewColor,
    previewOutlineColor = previewColor,
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
              outlineColor={previewOutlineColor}
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
  if (lineShape === "long_dashed") return "14 7";
  if (lineShape === "short_dashed") return "5 5";
  if (lineShape === "dotted") return "2 6";
  if (lineShape === "loose_dotted") return "2 10";
  if (lineShape === "dash_dot") return "10 5 2 5";
  if (lineShape === "dash_dot_dot") return "10 5 2 5 2 5";
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
  nodeState?: Pick<PostgresCanvasNodeState, "width" | "height"> | null,
): {
  width: number;
  height: number;
} {
  const defaultDimensions = getCanvasNodeDefaultDimensions(shape);
  return {
    width: nodeState?.width ?? defaultDimensions.width,
    height: nodeState?.height ?? defaultDimensions.height,
  };
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
  outlineColor: string,
  fill: PostgresObjectFill,
  sourceVisualKey: PostgresSourceObjectVisualKey | null = null,
): string {
  if (sourceVisualKey) {
    const strokeColor = outlineColor;
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
    return `<polygon points="${points}" fill="${fillColor}" stroke="${outlineColor}" stroke-width="2" />`;
  }
  if (shape === "rectangle") {
    return `<rect x="0" y="0" width="${width}" height="${height}" fill="${fillColor}" stroke="${outlineColor}" stroke-width="2" />`;
  }
  if (shape === "rounded") {
    const radius = Math.max(0, (Math.min(width, height) / 2) - 4);
    return `<circle cx="${width / 2}" cy="${height / 2}" r="${radius}" fill="${fillColor}" stroke="${outlineColor}" stroke-width="2" />`;
  }
  return `<rect x="0" y="0" width="${width}" height="${height}" rx="${Math.min(22, height / 3)}" ry="${Math.min(22, height / 3)}" fill="${fillColor}" stroke="${outlineColor}" stroke-width="2" />`;
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

function getSourceCanvasNodeDefaultDimensions(): {
  width: number;
  height: number;
} {
  return { width: 136, height: 136 };
}

function getSourceCanvasNodeRenderedDimensions(
  nodeState?: Pick<PostgresCanvasNodeState, "width" | "height"> | null,
): {
  width: number;
  height: number;
} {
  const defaultDimensions = getSourceCanvasNodeDefaultDimensions();
  return {
    width: nodeState?.width ?? defaultDimensions.width,
    height: nodeState?.height ?? defaultDimensions.height,
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
  outlineColor?: string;
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
    outlineColor = color,
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
  const surfaceStyle = getPostgresObjectSurfaceStyle(color, fill, selected, outlineColor);
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
            border: `1px solid ${hexToRgba(outlineColor, selected ? 0.72 : 0.42)}`,
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
    outlineColor?: string;
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
          const outlineColor = item.outlineColor || accentColor;
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
                border: `1px solid ${checked ? hexToRgba(outlineColor, 0.42) : "rgba(53, 80, 112, 0.12)"}`,
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
                outlineColor={outlineColor}
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
          <div className="segmented-control modal-segmented-control modal-secondary-segmented-control modal-secondary-segmented-control--two" role="tablist" aria-label="Object type graphic source">
            <button
              type="button"
              role="tab"
              aria-selected={graphicMode === "select"}
              className={`segmented-control-option ${graphicMode === "select" ? "segmented-control-option--active" : ""}`}
              onClick={() => onGraphicModeChange("select")}
              disabled={disabled}
            >
              Select
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={graphicMode === "upload"}
              className={`segmented-control-option ${graphicMode === "upload" ? "segmented-control-option--active" : ""}`}
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
    <SettingsModal
      title="Use image"
      onClose={onCancel}
      closeDisabled={busy}
      modalClassName="modal--wide"
      overlayStyle={{ zIndex: 300 }}
    >
      <div className="app-settings-modal-body">
        <p className="auth-hint" style={{ marginTop: 0 }}>
          Keep the full image or select a region to use for this object graphic.
        </p>
        <div className="segmented-control modal-segmented-control modal-secondary-segmented-control modal-secondary-segmented-control--two" role="tablist" aria-label="Image region mode">
          <button
            type="button"
            className={`segmented-control-option ${draft.mode === "full" ? "segmented-control-option--active" : ""}`}
            onClick={() => updateDraft({ mode: "full" })}
            disabled={busy}
          >
            Full image
          </button>
          <button
            type="button"
            className={`segmented-control-option ${draft.mode === "crop" ? "segmented-control-option--active" : ""}`}
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
      </div>
        <div className="app-settings-modal-footer">
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
    </SettingsModal>
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

function canvasNodeBounds(
  node: Pick<PostgresCanvasNodeState, "x" | "y" | "width" | "height">,
  gap = 0,
): { left: number; top: number; right: number; bottom: number } {
  return {
    left: node.x - gap,
    top: node.y - gap,
    right: node.x + (node.width || 0) + gap,
    bottom: node.y + (node.height || 0) + gap,
  };
}

function canvasBoundsOverlap(
  left: { left: number; top: number; right: number; bottom: number },
  right: { left: number; top: number; right: number; bottom: number },
): boolean {
  return left.left < right.right
    && left.right > right.left
    && left.top < right.bottom
    && left.bottom > right.top;
}

function findAvailableCanvasNodePosition({
  existingNodes,
  width,
  height,
  preferredPosition,
  fallbackPosition,
  gap = 36,
}: {
  existingNodes: Iterable<PostgresCanvasNodeState>;
  width: number;
  height: number;
  preferredPosition?: PostgresCanvasPoint | null;
  fallbackPosition?: PostgresCanvasPoint | null;
  gap?: number;
}): PostgresCanvasPoint {
  const existingBounds = Array.from(existingNodes).map((node) => canvasNodeBounds(node, gap));
  const fits = (position: PostgresCanvasPoint) => {
    const candidate = canvasNodeBounds({ x: position.x, y: position.y, width, height });
    return !existingBounds.some((bounds) => canvasBoundsOverlap(candidate, bounds));
  };
  const candidates = [preferredPosition, fallbackPosition].filter((position): position is PostgresCanvasPoint => Boolean(position));
  for (const candidate of candidates) {
    if (fits(candidate)) return candidate;
  }

  const origin = fallbackPosition
    ?? preferredPosition
    ?? (
      existingBounds.length > 0
        ? {
            x: Math.round(existingBounds.reduce((sum, bounds) => sum + bounds.left, 0) / existingBounds.length),
            y: Math.round(existingBounds.reduce((sum, bounds) => sum + bounds.top, 0) / existingBounds.length),
          }
        : { x: 0, y: 0 }
    );
  const stepX = Math.max(180, width + gap);
  const stepY = Math.max(140, height + gap);
  for (let radius = 1; radius <= 80; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const candidate = {
          x: origin.x + dx * stepX,
          y: origin.y + dy * stepY,
        };
        if (fits(candidate)) return candidate;
      }
    }
  }

  return {
    x: origin.x + (existingBounds.length + 1) * stepX,
    y: origin.y,
  };
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

function formatPostgresSourceKindLabel(kind: string): string {
  return POSTGRES_SOURCE_KIND_OPTIONS.find((option) => option.id === kind)?.label
    ?? (kind ? kind.split(/[_\s-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") : "Source");
}

function getPostgresSourceKindOption(kind: string | null | undefined) {
  const normalized = normalizePostgresSourceKind(kind ?? "");
  return POSTGRES_SOURCE_KIND_OPTIONS.find((option) => normalizePostgresSourceKind(option.id) === normalized) ?? null;
}

function getHomeCanvasSourceObjectTypeId(kind: string | null | undefined): string {
  const option = getPostgresSourceKindOption(kind);
  return option ? `__home_canvas_source:${option.sourceVisualKey}` : "__home_canvas_source";
}

function selectedSetOrAll(selection: Set<string>, allIds: string[]): Set<string> {
  if (selection.has("__none")) return new Set();
  return selection.size === 0 ? new Set(allIds) : selection;
}

function isHomeCanvasSelectionFiltered(selection: Set<string>, allIds: string[]): boolean {
  if (allIds.length === 0) return false;
  if (selection.has("__none")) return true;
  if (selection.size === 0) return false;
  if (selection.size !== allIds.length) return true;
  return allIds.some((id) => !selection.has(id));
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
    timelineRole: draft?.timelineRole ?? "",
  };
}

function normalizeAttributeModalOptions(options: string[]): string[] {
  return options.map((option) => option.trim()).filter(Boolean);
}

type TimelineFieldRole = Exclude<NonNullable<SharedAttributeDraft["timelineRole"]>, "">;

const TIMELINE_FIELD_OPTIONS: Array<{
  role: TimelineFieldRole;
  label: string;
  dataTypes: SharedAttributeDraft["dataType"][];
  defaultName: string;
}> = [
  { role: "timeline_start", label: "Start", dataTypes: ["datetime"], defaultName: "Timeline start" },
  { role: "timeline_end", label: "End", dataTypes: ["datetime"], defaultName: "Timeline end" },
  { role: "timeline_label", label: "Label", dataTypes: ["text", "categorical"], defaultName: "Timeline label" },
  { role: "timeline_item_type", label: "Item Type", dataTypes: ["categorical"], defaultName: "Timeline item type" },
  { role: "timeline_group", label: "Group", dataTypes: ["text", "categorical"], defaultName: "Timeline group" },
];

function timelineRoleFitsDataType(role: SharedAttributeDraft["timelineRole"], dataType: SharedAttributeDraft["dataType"]): boolean {
  if (!role) return true;
  const option = TIMELINE_FIELD_OPTIONS.find((entry) => entry.role === role);
  return option ? option.dataTypes.includes(dataType) : false;
}

function defaultTimelineAttributeOptions(role: TimelineFieldRole): string[] {
  return role === "timeline_item_type" ? ["Point", "Range"] : [];
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
  const effectiveTimelineRole = timelineRoleFitsDataType(draft.timelineRole, dataType) ? draft.timelineRole ?? "" : "";

  return (
    <SettingsModal title={title} onClose={onCancel} closeDisabled={saving} modalClassName="modal--wide">
      <div className="app-settings-modal-body">
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
      </div>
        <div className="app-settings-modal-footer">
          <button className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
          <button
            className="btn btn--primary"
            onClick={() => onSave({
              ...draft,
              name: name.trim(),
              dataType,
              description: description.trim(),
              options: normalizedOptions,
              timelineRole: effectiveTimelineRole,
              typeIds,
            })}
            disabled={saving || !name.trim() || typeIds.length === 0 || (dataType === "categorical" && normalizedOptions.length < 2)}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
    </SettingsModal>
  );
}

function GraphConfirmModal({
  title,
  children,
  warning,
  busy,
  confirmLabel,
  busyLabel,
  danger = true,
  confirmDisabled = false,
  onClose,
  onConfirm,
}: {
  title: string;
  children?: ReactNode;
  warning?: ReactNode;
  busy: boolean;
  confirmLabel: string;
  busyLabel?: string;
  danger?: boolean;
  confirmDisabled?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <SettingsModal title={title} onClose={onClose} closeDisabled={busy} modalClassName="modal--wide">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) onConfirm();
        }}
      >
        <div className="app-settings-modal-body">
          {children}
          {warning ? <p className="modal-warning-text">{warning}</p> : null}
        </div>
        <div className="app-settings-modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            autoFocus
            className={danger ? "btn btn--danger" : "btn btn--primary"}
            disabled={busy || confirmDisabled}
          >
            {busy && busyLabel ? busyLabel : confirmLabel}
          </button>
        </div>
      </form>
    </SettingsModal>
  );
}

export function PostgresProjectHomeView({
  project,
  authSession,
  onAuthSessionUpdated,
  onAuthSessionInvalidated,
  installationSettings,
  onBack,
  onProjectUpdated,
  onProjectDeleted,
  onProjectOpened,
  onSignOut,
}: PostgresProjectHomeViewProps) {
  const PROJECT_ROLE_OPTIONS = ["owner", "editor", "coder", "viewer"] as const;
  const [activeScreen, setActiveScreen] = useState<PostgresProjectScreen>("home");
  const [projectHomeTab, setProjectHomeTab] = useState<PostgresProjectHomeTab>("details");
  const [projectHomeGraphFitKey, setProjectHomeGraphFitKey] = useState(0);
  const projectHomeDetailsStatsRef = useRef<HTMLDivElement | null>(null);
  const [projectHomeDetailsStatsHeight, setProjectHomeDetailsStatsHeight] = useState(0);

  useEffect(() => {
    if (activeScreen === "home" && projectHomeTab === "graph") {
      setProjectHomeGraphFitKey((current) => current + 1);
    }
  }, [activeScreen, projectHomeTab]);
  const aiAssistAllowed =
    installationSettings == null
      ? true
      : installationSettings.aiAssistPolicy.mode === "enabled"
        ? true
        : installationSettings.aiAssistPolicy.mode === "project"
          ? installationSettings.aiAssistPolicy.projectOverrides[project.id] ?? true
          : false;
  const [sidebarNetworkMode, setSidebarNetworkMode] = useState<PostgresSidebarNetworkMode>("unknown");
  const [sidebarAiStatus, setSidebarAiStatus] = useState<PostgresSidebarAiStatus>("unavailable");
  const [postgresSourceNavigationTarget, setPostgresSourceNavigationTarget] = useState<{
    sourceId: string;
    annotationId: string | null;
    textSegment: { startOffset: number; endOffset: number } | null;
  } | null>(null);
  const [postgresAnnotationNavigationTargetId, setPostgresAnnotationNavigationTargetId] = useState<string | null>(null);
  const [postgresMemoDraftTarget, setPostgresMemoDraftTarget] = useState<PostgresMemoDraftTarget | null>(null);
  const [users, setUsers] = useState<PostgresProjectUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [selectedUserRoleFilter, setSelectedUserRoleFilter] = useState<(typeof PROJECT_ROLE_OPTIONS)[number] | "all">("all");
  const [objectTypes, setObjectTypes] = useState<PostgresObjectType[]>([]);
  const [objects, setObjects] = useState<PostgresObject[]>([]);
  const [sources, setSources] = useState<PostgresSource[]>([]);
  const [sourceTypeSettings, setSourceTypeSettings] = useState<PostgresSourceTypeSetting[]>([]);
  const [sourceAttributeDefinitions, setSourceAttributeDefinitions] = useState<PostgresSourceAttributeDefinition[]>([]);
  const [sourceAttributeValues, setSourceAttributeValues] = useState<PostgresSourceAttributeValue[]>([]);
  const [codes, setCodes] = useState<PostgresCode[]>([]);
  const [annotationSummaries, setAnnotationSummaries] = useState<PostgresAnnotationSummary[]>([]);
  const [memoCount, setMemoCount] = useState(0);
  const [reportCount, setReportCount] = useState(0);
  const [homeCanvasCreateMenuOpen, setHomeCanvasCreateMenuOpen] = useState(false);
  const [homeCanvasFilterDrawerOpen, setHomeCanvasFilterDrawerOpen] = useState(false);
  const [homeCanvasSizeMenuOpen, setHomeCanvasSizeMenuOpen] = useState(false);
  const [homeCanvasContextMenu, setHomeCanvasContextMenu] = useState<PostgresHomeCanvasContextMenuState | null>(null);
  const [homeCanvasDeleteTarget, setHomeCanvasDeleteTarget] = useState<PostgresHomeCanvasDeleteTarget | null>(null);
  const [createSourceOpen, setCreateSourceOpen] = useState(false);
  const [editingHomeCanvasSourceId, setEditingHomeCanvasSourceId] = useState<string | null>(null);
  const [sourceImportSettings, setSourceImportSettings] = useState({
    defaultMode: readAppSettings().documentImport.defaultMode,
    autoNameFromFile: readAppSettings().documentImport.autoNameFromFile,
    trimImportedText: readAppSettings().documentImport.trimImportedText,
    warnBeforeEmptyImport: readAppSettings().documentImport.warnBeforeEmptyImport,
    storeOriginalFileName: true,
  });
  const [createCodeOpen, setCreateCodeOpen] = useState(false);
  const [editingHomeCanvasCodeId, setEditingHomeCanvasCodeId] = useState<string | null>(null);
  const [homeCanvasEnabledSections, setHomeCanvasEnabledSections] = useState<Set<PostgresHomeCanvasSection>>(
    () => new Set(["sources", "objects", "relationships", "codes", "annotations"]),
  );
  const [homeCanvasCollapsedSections, setHomeCanvasCollapsedSections] = useState<Set<PostgresHomeCanvasSection>>(
    () => new Set(["sources", "objects", "relationships", "codes"]),
  );
  const [homeCanvasSizeCollapsedSections, setHomeCanvasSizeCollapsedSections] = useState<Set<PostgresHomeCanvasSizeSectionKey>>(
    () => new Set(["sources", "objects", "codes"]),
  );
  const [homeCanvasSourceKinds, setHomeCanvasSourceKinds] = useState<Set<string>>(() => new Set());
  const [homeCanvasObjectTypeIds, setHomeCanvasObjectTypeIds] = useState<Set<string>>(() => new Set());
  const [homeCanvasRelationshipTypeIds, setHomeCanvasRelationshipTypeIds] = useState<Set<string>>(() => new Set());
  const [homeCanvasCodeIds, setHomeCanvasCodeIds] = useState<Set<string>>(() => new Set());
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
  const [objectOutlineColorOverride, setObjectOutlineColorOverride] = useState("");
  const [objectFillOverride, setObjectFillOverride] = useState("");

  useEffect(() => {
    if (
      !aiAssistAllowed
      && activeScreen !== "ai-assist"
      && (
        activeScreen === "ai-assist-chat"
        || activeScreen === "ai-assisted-coding"
        || activeScreen === "ai-analyze"
        || activeScreen === "ai-assist-source-attributes"
        || activeScreen === "ai-assist-object-attributes"
        || activeScreen === "ai-assist-process-documents"
      )
    ) {
      setActiveScreen("ai-assist");
    }
  }, [activeScreen, aiAssistAllowed]);

  useLayoutEffect(() => {
    if (activeScreen !== "home" || projectHomeTab !== "details") {
      setProjectHomeDetailsStatsHeight(0);
      return;
    }
    const element = projectHomeDetailsStatsRef.current;
    if (!element) return;

    const updateHeight = () => {
      setProjectHomeDetailsStatsHeight(Math.ceil(element.getBoundingClientRect().height));
    };
    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    window.addEventListener("resize", updateHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [activeScreen, projectHomeTab, annotationSummaries.length, codes.length, memoCount, objects.length, relationships.length, reportCount, sources.length, users.length]);

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
  const [hoveredObjectAttributeColumnId, setHoveredObjectAttributeColumnId] = useState<string | null>(null);
  const [hoveredRelationshipAttributeColumnId, setHoveredRelationshipAttributeColumnId] = useState<string | null>(null);
  const [bulkObjectAttributeDefinition, setBulkObjectAttributeDefinition] = useState<PostgresObjectAttributeDefinition | null>(null);
  const [bulkRelationshipAttributeDefinition, setBulkRelationshipAttributeDefinition] = useState<PostgresRelationshipAttributeDefinition | null>(null);
  const [showObjectAttributesTable, setShowObjectAttributesTable] = useState(false);
  const [showRelationshipAttributesTable, setShowRelationshipAttributesTable] = useState(false);
  const [objectTypeSortCol, setObjectTypeSortCol] = useState<PostgresObjectTypeSortCol>("objectType");
  const [objectTypeSortDir, setObjectTypeSortDir] = useState<"asc" | "desc">("asc");
  const [userRoleSortCol, setUserRoleSortCol] = useState<PostgresUserRoleSortCol>("role");
  const [userRoleSortDir, setUserRoleSortDir] = useState<"asc" | "desc">("asc");
  const [relationshipTypeSortCol, setRelationshipTypeSortCol] = useState<PostgresRelationshipTypeSortCol>("relationshipType");
  const [relationshipTypeSortDir, setRelationshipTypeSortDir] = useState<"asc" | "desc">("asc");
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
  const [draftObjectTypeOutlineColor, setDraftObjectTypeOutlineColor] = useState("");
  const [draftObjectTypeFill, setDraftObjectTypeFill] = useState<PostgresObjectFill>("filled");
  const [draftObjectTypeImageStoragePath, setDraftObjectTypeImageStoragePath] = useState("");
  const [draftObjectTypePendingImage, setDraftObjectTypePendingImage] = useState<PostgresImageUploadDraft | null>(null);
  const [draftObjectTypeGraphicMode, setDraftObjectTypeGraphicMode] = useState<PostgresObjectGraphicMode>("select");
  const [objectTypeModalTab, setObjectTypeModalTab] = useState<"details" | "graphics" | "attributes" | "timeline">("details");
  const [createObjectModalTab, setCreateObjectModalTab] = useState<"details" | "graphics" | "attributes" | "timeline">("details");
  const [objectTypeAttributeDrafts, setObjectTypeAttributeDrafts] = useState<TypeAttributeDraft[]>([]);
  const [objectTypeAttributeValuesByDraftId, setObjectTypeAttributeValuesByDraftId] = useState<EditableAttributeMatrixValues>({});
  const [objectTypeAttributeModalDraft, setObjectTypeAttributeModalDraft] = useState<TypeAttributeDraft | null>(null);
  const [editingObjectId, setEditingObjectId] = useState<string | null>(null);
  const [editObjectModalTab, setEditObjectModalTab] = useState<"details" | "graphics" | "attributes" | "timeline">("details");
  const [editingObjectTypeId, setEditingObjectTypeId] = useState("");
  const [editingObjectTitle, setEditingObjectTitle] = useState("");
  const [editingObjectDescription, setEditingObjectDescription] = useState("");
  const [editingObjectShapeOverride, setEditingObjectShapeOverride] = useState("");
  const [editingObjectColorOverride, setEditingObjectColorOverride] = useState("");
  const [editingObjectOutlineColorOverride, setEditingObjectOutlineColorOverride] = useState("");
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
  const [relationshipTypeModalTab, setRelationshipTypeModalTab] = useState<"details" | "object1" | "object2" | "attributes" | "timeline">("details");
  const [relationshipTypeAttributeValuesByDraftId, setRelationshipTypeAttributeValuesByDraftId] = useState<EditableAttributeMatrixValues>({});
  const [relationshipTypeId, setRelationshipTypeId] = useState("");
  const [relationshipDescription, setRelationshipDescription] = useState("");
  const [relationshipLineShapeOverride, setRelationshipLineShapeOverride] = useState("");
  const [relationshipLineWeightOverride, setRelationshipLineWeightOverride] = useState<number | null>(null);
  const [relationshipArrowheadOverride, setRelationshipArrowheadOverride] = useState("");
  const [relationshipColorOverride, setRelationshipColorOverride] = useState("");
  const [relationshipAttributeValues, setRelationshipAttributeValues] = useState<Record<string, string>>({});
  const [createRelationshipOpen, setCreateRelationshipOpen] = useState(false);
  const [createRelationshipModalTab, setCreateRelationshipModalTab] = useState<"details" | "graphics" | "attributes" | "timeline">("details");
  const [editingRelationshipId, setEditingRelationshipId] = useState<string | null>(null);
  const [editRelationshipModalTab, setEditRelationshipModalTab] = useState<"details" | "graphics" | "attributes" | "timeline">("details");
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
  const homeCanvasCreateControlRef = useRef<HTMLDivElement>(null);
  const homeCanvasFilterControlRef = useRef<HTMLDivElement>(null);
  const homeCanvasSizeControlRef = useRef<HTMLDivElement>(null);
  const objectById = new Map(objects.map((object) => [object.id, object]));
  const objectTypeById = new Map(objectTypes.map((objectType) => [objectType.id, objectType]));
  const relationshipTypeById = new Map(relationshipTypes.map((relationshipType) => [relationshipType.id, relationshipType]));
  useEffect(() => {
    if (!homeCanvasCreateMenuOpen) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (homeCanvasCreateControlRef.current?.contains(target)) return;
      setHomeCanvasCreateMenuOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [homeCanvasCreateMenuOpen]);
  useEffect(() => {
    if (!homeCanvasFilterDrawerOpen) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (homeCanvasFilterControlRef.current?.contains(target)) return;
      setHomeCanvasFilterDrawerOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setHomeCanvasFilterDrawerOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [homeCanvasFilterDrawerOpen]);
  useEffect(() => {
    if (!homeCanvasSizeMenuOpen) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (homeCanvasSizeControlRef.current?.contains(target)) return;
      setHomeCanvasSizeMenuOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setHomeCanvasSizeMenuOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [homeCanvasSizeMenuOpen]);
  useEffect(() => {
    if (!homeCanvasContextMenu) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-home-canvas-context-menu]")) return;
      setHomeCanvasContextMenu(null);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setHomeCanvasContextMenu(null);
    }
    function handleResize() {
      setHomeCanvasContextMenu(null);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
    };
  }, [homeCanvasContextMenu]);
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
          outlineColor: objectTypeRecord.outlineColor,
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
    .sort((left, right) => {
      let comparison = 0;
      if (relationshipTypeSortCol === "count") {
        comparison = left.count - right.count;
        if (comparison === 0) {
          comparison = left.relationshipType.localeCompare(right.relationshipType, undefined, { sensitivity: "base" });
        }
      } else {
        comparison = left.relationshipType.localeCompare(right.relationshipType, undefined, { sensitivity: "base" });
      }
      return relationshipTypeSortDir === "asc" ? comparison : -comparison;
    });
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

  function handleUserRoleSort(column: PostgresUserRoleSortCol) {
    if (userRoleSortCol === column) {
      setUserRoleSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setUserRoleSortCol(column);
    setUserRoleSortDir("asc");
  }

  function handleRelationshipTypeSort(column: PostgresRelationshipTypeSortCol) {
    if (relationshipTypeSortCol === column) {
      setRelationshipTypeSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setRelationshipTypeSortCol(column);
    setRelationshipTypeSortDir("asc");
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
  function relationshipEndpointKeyForRelationship(relationship: PostgresRelationship, endpoint: "from" | "to"): string {
    if (endpoint === "from") {
      return `${relationship.fromEntityType || "object"}:${relationship.fromEntityId || relationship.fromObjectId}`;
    }
    return `${relationship.toEntityType || "object"}:${relationship.toEntityId || relationship.toObjectId}`;
  }
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
  const availableEditingFromEndpointOptions = useMemo<PostgresRelationshipEndpointOption[]>(() => {
    if (!editingRelationshipTypeRecord) return [];
    return [
      ...objects
        .filter((object) => postgresRelationshipTypeAllowsObjectEndpoint(editingRelationshipTypeRecord, "from", object.objectTypeId))
        .map((object) => ({
          key: `object:${object.id}`,
          entityType: "object" as const,
          entityId: object.id,
          name: object.title,
          type: object.objectType || "Object",
        })),
      ...sources
        .filter((source) => postgresRelationshipTypeAllowsSourceEndpoint(editingRelationshipTypeRecord, "from", source.sourceKind))
        .map((source) => ({
          key: `source:${source.id}`,
          entityType: "source" as const,
          entityId: source.id,
          name: source.title,
          type: POSTGRES_SOURCE_KIND_OPTIONS.find((option) => option.id === source.sourceKind)?.label ?? (source.sourceKind || "Source"),
        })),
    ].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  }, [editingRelationshipTypeRecord, objects, sources]);
  const availableEditingToEndpointOptions = useMemo<PostgresRelationshipEndpointOption[]>(() => {
    if (!editingRelationshipTypeRecord) return [];
    return [
      ...objects
        .filter((object) => postgresRelationshipTypeAllowsObjectEndpoint(editingRelationshipTypeRecord, "to", object.objectTypeId))
        .map((object) => ({
          key: `object:${object.id}`,
          entityType: "object" as const,
          entityId: object.id,
          name: object.title,
          type: object.objectType || "Object",
        })),
      ...sources
        .filter((source) => postgresRelationshipTypeAllowsSourceEndpoint(editingRelationshipTypeRecord, "to", source.sourceKind))
        .map((source) => ({
          key: `source:${source.id}`,
          entityType: "source" as const,
          entityId: source.id,
          name: source.title,
          type: POSTGRES_SOURCE_KIND_OPTIONS.find((option) => option.id === source.sourceKind)?.label ?? (source.sourceKind || "Source"),
        })),
    ].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  }, [editingRelationshipTypeRecord, objects, sources]);

  const codeRowsForModal = useMemo<CodeRow[]>(
    () => codes.map((code) => ({
      id: code.id,
      label: code.label,
      color: code.color,
      description: code.description,
      parentId: code.parentCodeId ?? "",
      parentLabel: codes.find((entry) => entry.id === code.parentCodeId)?.label ?? "",
      createdByName: code.createdByName ?? "",
      createdAt: code.createdAt,
      sourcesCount: 0,
    })),
    [codes],
  );
  const sourceRowsForEditor = useMemo<SourceRow[]>(
    () => sources.map((source) => ({
      id: source.id,
      name: source.title,
      type: source.sourceKind,
      sourceObjectType: formatPostgresSourceKindLabel(source.sourceKind),
      sourceObjectTypeSystemKey: getPostgresSourceKindOption(source.sourceKind)?.sourceVisualKey ?? null,
      notes: source.notes,
      content: source.textContent,
      structuredContentJson: source.structuredContentJson,
      waveformPeaksJson: source.waveformPeaksJson,
      videoFrameIndexJson: source.videoFrameIndexJson,
      extractedFromVideoSourceId: source.extractedFromVideoSourceId,
      extractedFromVideoTimeMs: source.extractedFromVideoTimeMs,
      filePath: source.storagePath || source.originalFileName,
      annotationCount: annotationSummaries.filter((annotation) => annotation.sourceId === source.id).length,
      objectCount: 0,
      createdAt: source.createdAt,
    })),
    [annotationSummaries, sources],
  );
  const editingHomeCanvasSource = editingHomeCanvasSourceId
    ? sourceRowsForEditor.find((source) => source.id === editingHomeCanvasSourceId) ?? null
    : null;
  const editingHomeCanvasCode = editingHomeCanvasCodeId
    ? codes.find((code) => code.id === editingHomeCanvasCodeId) ?? null
    : null;

  function openCreateSourceModal() {
    setGraphError("");
    setHomeCanvasCreateMenuOpen(false);
    setCreateSourceOpen(true);
  }

  function openCreateCodeModal() {
    setGraphError("");
    setHomeCanvasCreateMenuOpen(false);
    setCreateCodeOpen(true);
  }

  function openCreateObjectTypeModal() {
    setEditingObjectTypeModalId(null);
    setDraftObjectTypeName("");
    setDraftObjectTypeDescription("");
    setDraftObjectTypeShape("rounded");
    setDraftObjectTypeColor(POSTGRES_OBJECT_TYPE_DEFAULT_COLOR);
    setDraftObjectTypeOutlineColor("");
    setDraftObjectTypeFill("filled");
    setDraftObjectTypeImageStoragePath("");
    setDraftObjectTypePendingImage(null);
    setDraftObjectTypeGraphicMode("select");
    initializeObjectTypeAttributeEditor(null);
    setObjectTypeModalTab("details");
    setGraphError("");
    setCreateObjectTypeOpen(true);
  }

  function openCreateObjectModal(prefilledTypeId?: string, preferredPosition?: PostgresCanvasPoint) {
    const nextTypeId = prefilledTypeId
      ?? (selectedObjectTypeFilter !== "all" ? selectedObjectTypeFilter : objectTypeId)
      ?? "";
    setHomeCanvasCreateMenuOpen(false);
    setObjectTypeId(nextTypeId || objectTypes[0]?.id || "");
    setObjectTitle("");
    setObjectDescription("");
    setObjectShapeOverride("");
    setObjectColorOverride("");
    setObjectOutlineColorOverride("");
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

  function openEditObjectModal(object: PostgresObject, initialTab: "details" | "graphics" | "attributes" | "timeline" = "details") {
    setEditingObjectId(object.id);
    setEditObjectModalTab(initialTab);
    setEditingObjectTypeId(object.objectTypeId);
    setEditingObjectTitle(object.title);
    setEditingObjectDescription(object.description);
    setEditingObjectShapeOverride(object.shapeOverride ?? "");
    setEditingObjectColorOverride(object.colorOverride ?? "");
    setEditingObjectOutlineColorOverride(object.outlineColorOverride ?? "");
    setEditingObjectFillOverride(object.fillOverride ?? "");
    setEditingObjectImageStoragePath(object.imageStoragePath ?? "");
    setEditingObjectGraphicMode(
      object.imageStoragePath
        ? "upload"
        : object.shapeOverride || object.colorOverride || object.outlineColorOverride || object.fillOverride
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
    setDraftObjectTypeOutlineColor(
      normalizeOptionalPostgresObjectTypeColor(objectTypeRecord.outlineColor ?? ""),
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

  function openEditRelationshipModal(relationship: PostgresRelationship, initialTab: "details" | "graphics" | "attributes" | "timeline" = "details") {
    setEditRelationshipModalTab(initialTab);
    setEditingRelationshipId(relationship.id);
    setEditingRelationshipFromObjectId(relationshipEndpointKeyForRelationship(relationship, "from"));
    setEditingRelationshipToObjectId(relationshipEndpointKeyForRelationship(relationship, "to"));
    setEditingRelationshipTypeId(relationship.relationshipTypeId);
    setEditingRelationshipDescription(relationship.description);
    setEditingRelationshipLineShapeOverride(relationship.lineShapeOverride ?? "");
    setEditingRelationshipLineWeightOverride(relationship.lineWeightOverride ?? null);
    setEditingRelationshipArrowheadOverride(relationship.arrowheadOverride ?? "");
    setEditingRelationshipColorOverride(relationship.colorOverride ?? "");
    setEditingRelationshipAttributeValues(valuesForRelationship(relationship));
  }

  function relationshipTypeAllowsEndpointKey(
    relationshipType: PostgresRelationshipType,
    endpoint: "from" | "to",
    endpointKey: string,
  ): boolean {
    const parsed = parsePostgresRelationshipEndpointKey(endpointKey);
    if (!parsed) return false;
    if (parsed.entityType === "source") {
      const source = sources.find((entry) => entry.id === parsed.entityId);
      return source ? postgresRelationshipTypeAllowsSourceEndpoint(relationshipType, endpoint, source.sourceKind) : false;
    }
    const object = objectById.get(parsed.entityId);
    return object ? postgresRelationshipTypeAllowsObjectEndpoint(relationshipType, endpoint, object.objectTypeId) : false;
  }

  function selectRelationshipTypeForEndpoints(fromEndpointKey: string, toEndpointKey: string): string {
    return relationshipTypes.find((relationshipType) =>
      relationshipTypeAllowsEndpointKey(relationshipType, "from", fromEndpointKey)
      && relationshipTypeAllowsEndpointKey(relationshipType, "to", toEndpointKey)
    )?.id ?? relationshipTypeId;
  }

  function openCreateRelationshipModal(prefill?: { fromEndpointKey?: string; toEndpointKey?: string }) {
    setHomeCanvasCreateMenuOpen(false);
    setCreateRelationshipModalTab("details");
    const nextRelationshipTypeId =
      prefill?.fromEndpointKey && prefill.toEndpointKey
        ? selectRelationshipTypeForEndpoints(prefill.fromEndpointKey, prefill.toEndpointKey)
        : relationshipTypeId;
    if (nextRelationshipTypeId) setRelationshipTypeId(nextRelationshipTypeId);
    setFromObjectId(prefill?.fromEndpointKey ?? "");
    setToObjectId(prefill?.toEndpointKey ?? "");
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

  function closeHomeCanvasContextMenu() {
    setHomeCanvasContextMenu(null);
  }

  function viewHomeCanvasItem(menu: PostgresHomeCanvasContextMenuState) {
    closeHomeCanvasContextMenu();
    if (!menu.id) return;
    if (menu.kind === "source") {
      setPostgresSourceNavigationTarget({ sourceId: menu.id, annotationId: null, textSegment: null });
      setActiveScreen("sources");
      return;
    }
    if (menu.kind === "object") {
      setSelectedObjectDetailsId(menu.id);
      setActiveScreen("objects");
      return;
    }
    if (menu.kind === "relationship") {
      setSelectedRelationshipDetailsId(menu.id);
      setActiveScreen("relationships");
      return;
    }
    if (menu.kind === "code") {
      setActiveScreen("codebook");
      return;
    }
    if (menu.kind === "annotation") {
      const annotation = annotationSummaries.find((entry) => entry.id === menu.id);
      if (annotation) {
        setPostgresSourceNavigationTarget({ sourceId: annotation.sourceId, annotationId: annotation.id, textSegment: null });
        setActiveScreen("sources");
      } else {
        setActiveScreen("annotations");
      }
    }
  }

  function editHomeCanvasItem(menu: PostgresHomeCanvasContextMenuState) {
    closeHomeCanvasContextMenu();
    if (!menu.id) return;
    if (menu.kind === "source") {
      setEditingHomeCanvasSourceId(menu.id);
      return;
    }
    if (menu.kind === "object") {
      const object = objects.find((entry) => entry.id === menu.id);
      if (object) openEditObjectModal(object);
      return;
    }
    if (menu.kind === "relationship") {
      const relationship = relationships.find((entry) => entry.id === menu.id);
      if (relationship) openEditRelationshipModal(relationship);
      return;
    }
    if (menu.kind === "code") {
      setEditingHomeCanvasCodeId(menu.id);
    }
  }

  function homeCanvasSourceAttributeDraftValuesFor(row: SourceRow | null | undefined): Record<string, string> {
    if (!row) return {};
    return Object.fromEntries(
      sourceAttributeDefinitions.map((definition) => [
        definition.id,
        sourceAttributeValues.find((value) =>
          value.sourceId === row.id && value.attributeDefinitionId === definition.id
        )?.value ?? "",
      ]),
    );
  }

  function getHomeCanvasDeleteTarget(menu: PostgresHomeCanvasContextMenuState): PostgresHomeCanvasDeleteTarget | null {
    if (!menu.id) return null;
    if (menu.kind === "source") {
      const source = sources.find((entry) => entry.id === menu.id);
      if (!source) return null;
      return { kind: "source", id: source.id, label: source.title || source.originalFileName || "Untitled source" };
    }
    if (menu.kind === "object") {
      const object = objects.find((entry) => entry.id === menu.id);
      if (!object) return null;
      return { kind: "object", id: object.id, label: object.title || "Untitled object" };
    }
    if (menu.kind === "relationship") {
      const relationship = relationships.find((entry) => entry.id === menu.id);
      if (!relationship) return null;
      return { kind: "relationship", id: relationship.id, label: relationship.relationshipType || "Relationship" };
    }
    if (menu.kind === "code") {
      const code = codes.find((entry) => entry.id === menu.id);
      if (!code) return null;
      return { kind: "code", id: code.id, label: code.label || "Untitled code" };
    }
    return null;
  }

  function getHomeCanvasDeleteTargetForSelection(selection: { kind: "node" | "edge"; id: string }): PostgresHomeCanvasDeleteTarget | null {
    if (selection.kind === "edge") {
      if (selection.id.startsWith("annotation:")) return null;
      const relationship = relationships.find((entry) => entry.id === selection.id);
      if (!relationship) return null;
      return { kind: "relationship", id: relationship.id, label: relationship.relationshipType || "Relationship" };
    }

    const canvasObject = homeCanvasObjects.find((entry) => entry.id === selection.id);
    const systemKey = canvasObject?.objectTypeSystemKey ?? "";
    if (systemKey === "home_canvas_annotation") return null;
    if (systemKey === "home_canvas_code") {
      const code = codes.find((entry) => entry.id === selection.id);
      if (!code) return null;
      return { kind: "code", id: code.id, label: code.label || "Untitled code" };
    }
    if (systemKey === "home_canvas_source" || isPostgresSourceObjectVisualKey(systemKey)) {
      const source = sources.find((entry) => entry.id === selection.id);
      if (!source) return null;
      return { kind: "source", id: source.id, label: source.title || source.originalFileName || "Untitled source" };
    }

    const object = objects.find((entry) => entry.id === selection.id);
    if (!object) return null;
    return { kind: "object", id: object.id, label: object.title || "Untitled object" };
  }

  function startHomeCanvasDelete(menu: PostgresHomeCanvasContextMenuState) {
    if (!canDeleteHomeCanvasItems) return;
    const target = getHomeCanvasDeleteTarget(menu);
    if (!target) return;
    closeHomeCanvasContextMenu();
    setHomeCanvasDeleteTarget(target);
  }

  function startHomeCanvasSelectionDelete(selection: { kind: "node" | "edge"; id: string }) {
    if (!canDeleteHomeCanvasItems) return;
    const target = getHomeCanvasDeleteTargetForSelection(selection);
    if (!target) return;
    closeHomeCanvasContextMenu();
    setHomeCanvasDeleteTarget(target);
  }

  async function handleConfirmHomeCanvasDelete() {
    if (!homeCanvasDeleteTarget || !canDeleteHomeCanvasItems) return;
    setGraphSubmitting(true);
    setGraphError("");
    setGraphNotice("");
    try {
      if (homeCanvasDeleteTarget.kind === "source") {
        await deletePostgresSource(project.id, homeCanvasDeleteTarget.id);
        setSources((current) => current.filter((entry) => entry.id !== homeCanvasDeleteTarget.id));
        setRelationships((current) =>
          current.filter((entry) => entry.fromEntityId !== homeCanvasDeleteTarget.id && entry.toEntityId !== homeCanvasDeleteTarget.id),
        );
        setSourceAttributeValues((current) => current.filter((value) => value.sourceId !== homeCanvasDeleteTarget.id));
        setAnnotationSummaries((current) => current.filter((annotation) => annotation.sourceId !== homeCanvasDeleteTarget.id));
      } else if (homeCanvasDeleteTarget.kind === "object") {
        await deletePostgresObject(project.id, homeCanvasDeleteTarget.id);
        setObjects((current) => current.filter((entry) => entry.id !== homeCanvasDeleteTarget.id));
        setRelationships((current) =>
          current.filter((entry) => entry.fromObjectId !== homeCanvasDeleteTarget.id && entry.toObjectId !== homeCanvasDeleteTarget.id),
        );
      } else if (homeCanvasDeleteTarget.kind === "relationship") {
        await deletePostgresRelationship(project.id, homeCanvasDeleteTarget.id);
        setRelationships((current) => current.filter((entry) => entry.id !== homeCanvasDeleteTarget.id));
      } else {
        await deletePostgresCode(project.id, homeCanvasDeleteTarget.id);
        const removedCodeIds = new Set<string>([homeCanvasDeleteTarget.id]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const code of codes) {
            if (code.parentCodeId && removedCodeIds.has(code.parentCodeId) && !removedCodeIds.has(code.id)) {
              removedCodeIds.add(code.id);
              changed = true;
            }
          }
        }
        setCodes((current) => current.filter((entry) => !removedCodeIds.has(entry.id)));
        setAnnotationSummaries((current) =>
          current
            .map((annotation) => {
              const nextCodeIds = annotation.codeIds.filter((codeId) => !removedCodeIds.has(codeId));
              if (nextCodeIds.length === 0) return null;
              const primaryCodeRemoved = annotation.primaryCodeId && removedCodeIds.has(annotation.primaryCodeId);
              return {
                ...annotation,
                codeIds: nextCodeIds,
                primaryCodeId: primaryCodeRemoved ? nextCodeIds[0] ?? "" : annotation.primaryCodeId,
                primaryCodeLabel: primaryCodeRemoved
                  ? codes.find((code) => code.id === nextCodeIds[0])?.label ?? annotation.primaryCodeLabel
                  : annotation.primaryCodeLabel,
              };
            })
            .filter((annotation): annotation is PostgresAnnotationSummary => Boolean(annotation)),
        );
      }
      setHomeCanvasDeleteTarget(null);
      setGraphNotice(`Deleted ${homeCanvasDeleteTarget.kind}.`);
    } catch (deleteError) {
      setGraphError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setGraphSubmitting(false);
    }
  }

  async function handleCreateSource(payload:
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
    setGraphSubmitting(true);
    setGraphError("");
    setGraphNotice("");
    try {
      const createdSources: PostgresSource[] = [];
      if (payload.mode === "paste") {
        const created = await createPostgresSource({
          projectId: project.id,
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
        createdSources.push(created);
      } else {
        for (const item of payload.items) {
          const bytes = new Uint8Array(await item.file.arrayBuffer());
          const waveformPeaksJson = item.sourceKind === "audio" || item.sourceKind === "video"
            ? serializeMediaWaveformCache(await createMediaWaveformCache(bytes))
            : "";
          const videoFrameIndexJson = item.sourceKind === "video"
            ? serializeMediaVideoFrameIndexCache(await createMediaVideoFrameIndexCache(bytes))
            : "";
          const created = await importPostgresSourceFile({
            projectId: project.id,
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
          createdSources.push(created);
        }
      }

      if (createdSources.length > 0) {
        setSources((current) => [...current, ...createdSources]);
      }
      setCreateSourceOpen(false);
    } catch (saveError) {
      setGraphError(saveError instanceof Error ? saveError.message : "Failed to save source.");
    } finally {
      setGraphSubmitting(false);
    }
  }

  async function handleUpdateHomeCanvasSource(payload: {
    sourceKind: string;
    name: string;
    notes: string;
    content: string;
    attributeValuesByDefinitionId: Record<string, string>;
  }) {
    if (!editingHomeCanvasSource) return;
    setGraphSubmitting(true);
    setGraphError("");
    setGraphNotice("");
    try {
      const saved = await updatePostgresSource({
        projectId: project.id,
        sourceId: editingHomeCanvasSource.id,
        sourceKind: payload.sourceKind.trim(),
        title: payload.name.trim(),
        textContent: payload.content,
        notes: payload.notes,
        structuredContentJson: editingHomeCanvasSource.structuredContentJson,
        waveformPeaksJson: editingHomeCanvasSource.waveformPeaksJson,
        videoFrameIndexJson: editingHomeCanvasSource.videoFrameIndexJson,
        extractedFromVideoSourceId: editingHomeCanvasSource.extractedFromVideoSourceId,
        extractedFromVideoTimeMs: editingHomeCanvasSource.extractedFromVideoTimeMs,
        originalFileName: editingHomeCanvasSource.filePath,
        storagePath: editingHomeCanvasSource.filePath,
      });

      for (const definition of sourceAttributeDefinitions) {
        const previousValue = sourceAttributeValues.find((value) =>
          value.sourceId === saved.id && value.attributeDefinitionId === definition.id
        )?.value ?? "";
        const nextValue = payload.attributeValuesByDefinitionId[definition.id] ?? "";
        if (nextValue === previousValue) continue;
        await savePostgresSourceAttribute({
          projectId: project.id,
          attributeDefinitionId: definition.id,
          name: definition.name,
          dataType: definition.dataType,
          description: definition.description,
          options: definition.options,
          sourceKinds: definition.sourceKinds,
          values: sources
            .filter((source) => source.id !== saved.id)
            .map((source) => ({
              sourceId: source.id,
              value: sourceAttributeValues.find((value) =>
                value.sourceId === source.id && value.attributeDefinitionId === definition.id
              )?.value ?? "",
            }))
            .concat({ sourceId: saved.id, value: nextValue }),
        });
      }

      setSources((current) => current.map((entry) => (entry.id === saved.id ? saved : entry)));
      setSourceAttributeValues((current) => {
        let nextValues = current;
        for (const definition of sourceAttributeDefinitions) {
          const nextValue = payload.attributeValuesByDefinitionId[definition.id] ?? "";
          const existing = nextValues.find((value) =>
            value.sourceId === saved.id && value.attributeDefinitionId === definition.id
          );
          if (existing) {
            nextValues = nextValues.map((value) =>
              value.sourceId === saved.id && value.attributeDefinitionId === definition.id
                ? { ...value, value: nextValue }
                : value,
            );
          } else if (nextValue) {
            nextValues = nextValues.concat({
              id: `${saved.id}:${definition.id}`,
              sourceId: saved.id,
              attributeDefinitionId: definition.id,
              attributeName: definition.name,
              dataType: definition.dataType,
              value: nextValue,
              sortOrder: definition.sortOrder,
            });
          }
        }
        return nextValues;
      });
      setEditingHomeCanvasSourceId(null);
    } catch (saveError) {
      setGraphError(saveError instanceof Error ? saveError.message : "Failed to update source.");
      throw saveError;
    } finally {
      setGraphSubmitting(false);
    }
  }

  async function handleCreateCode(payload: {
    label: string;
    color: string;
    description: string;
    parentId?: string;
  }) {
    setGraphSubmitting(true);
    setGraphError("");
    setGraphNotice("");
    try {
      const created = await createPostgresCode({
        projectId: project.id,
        label: payload.label,
        color: payload.color,
        description: payload.description,
        parentCodeId: payload.parentId ?? "",
        shortcut: "",
      });
      setCodes((current) => [...current, created]);
      setCreateCodeOpen(false);
    } catch (saveError) {
      setGraphError(saveError instanceof Error ? saveError.message : "Failed to save code.");
      throw saveError;
    } finally {
      setGraphSubmitting(false);
    }
  }

  async function handleUpdateHomeCanvasCode(payload: {
    label: string;
    color: string;
    description: string;
    parentId?: string;
  }) {
    if (!editingHomeCanvasCodeId) return;
    setGraphSubmitting(true);
    setGraphError("");
    setGraphNotice("");
    try {
      const updated = await updatePostgresCode({
        projectId: project.id,
        codeId: editingHomeCanvasCodeId,
        label: payload.label,
        color: payload.color,
        description: payload.description,
        parentCodeId: payload.parentId ?? "",
        shortcut: "",
      });
      setCodes((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      setAnnotationSummaries((current) =>
        current.map((annotation) =>
          annotation.primaryCodeId === updated.id
            ? { ...annotation, primaryCodeLabel: updated.label }
            : annotation,
        ),
      );
      setEditingHomeCanvasCodeId(null);
    } catch (saveError) {
      setGraphError(saveError instanceof Error ? saveError.message : "Failed to update code.");
      throw saveError;
    } finally {
      setGraphSubmitting(false);
    }
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
    const definitions = objectTypeId
      ? objectAttributeDefinitions.filter((definition) => definition.objectTypeId === objectTypeId)
      : [];
    const matchingObjects = objectTypeId
      ? objects.filter((object) => object.objectTypeId === objectTypeId)
      : [];
    const drafts = definitions
      .map((definition) =>
        createTypeAttributeDraft({
          id: definition.id,
          name: definition.name,
          dataType: definition.dataType,
          description: definition.description,
          options: definition.options,
          timelineRole: definition.timelineRole,
        }));
    setObjectTypeAttributeDrafts(drafts);
    setObjectTypeAttributeValuesByDraftId(Object.fromEntries(
      drafts.map((draft) => [
        draft.localId,
        Object.fromEntries(
          matchingObjects.map((object) => [
            object.id,
            object.attributeValues.find((value) => value.attributeDefinitionId === draft.id)?.value ?? "",
          ]),
        ),
      ]),
    ));
    setObjectTypeAttributeModalDraft(null);
    setTypeAttributeModalError("");
  }

  function initializeRelationshipTypeAttributeEditor(relationshipTypeId: string | null) {
    const definitions = relationshipTypeId
      ? relationshipAttributeDefinitions.filter((definition) => definition.relationshipTypeId === relationshipTypeId)
      : [];
    const matchingRelationships = relationshipTypeId
      ? relationships.filter((relationship) => relationship.relationshipTypeId === relationshipTypeId)
      : [];
    const drafts = definitions
      .map((definition) =>
        createTypeAttributeDraft({
          id: definition.id,
          name: definition.name,
          dataType: definition.dataType,
          description: definition.description,
          options: definition.options,
          timelineRole: definition.timelineRole,
        }));
    setRelationshipTypeAttributeDrafts(drafts);
    setRelationshipTypeAttributeValuesByDraftId(
      Object.fromEntries(
        drafts.map((draft) => [
          draft.localId,
          Object.fromEntries(
            matchingRelationships.map((relationship) => [
              relationship.id,
              relationship.attributeValues.find((value) => value.attributeDefinitionId === draft.id)?.value ?? "",
            ]),
          ),
        ]),
      ),
    );
    setRelationshipTypeAttributeModalDraft(null);
    setTypeAttributeModalError("");
  }

  function renderRelationshipTypeModal(config: {
    title: string;
    hint?: string;
    relationshipTypeId?: string | null;
    submitLabel: string;
    ariaLabel: string;
    onClose: () => void;
    onSubmit: (event: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
  }) {
    const relationshipTypeMatrixRows = (config.relationshipTypeId
      ? relationships.filter((relationship) => relationship.relationshipTypeId === config.relationshipTypeId)
      : [])
      .map((relationship) => ({
        id: relationship.id,
        name: relationship.description
          || `${relationship.fromEntityName || relationship.fromObjectId} -> ${relationship.toEntityName || relationship.toObjectId}`,
      }))
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));

    return (
      <SettingsModal
        title={config.title}
        subtitle={config.hint}
        onClose={config.onClose}
        closeDisabled={graphSubmitting}
        modalClassName="modal--wide"
        overlayStyle={{ zIndex: 120 }}
      >
          <form onSubmit={config.onSubmit} className="form app-settings-modal-body">
            <div className="segmented-control modal-segmented-control" role="tablist" aria-label={config.ariaLabel}>
              <button
                type="button"
                className={`segmented-control-option ${relationshipTypeModalTab === "details" ? "segmented-control-option--active" : ""}`}
                onClick={() => setRelationshipTypeModalTab("details")}
              >
                Details
              </button>
              <button
                type="button"
                className={`segmented-control-option ${relationshipTypeModalTab === "object1" ? "segmented-control-option--active" : ""}`}
                onClick={() => setRelationshipTypeModalTab("object1")}
              >
                Object 1
              </button>
              <button
                type="button"
                className={`segmented-control-option ${relationshipTypeModalTab === "object2" ? "segmented-control-option--active" : ""}`}
                onClick={() => setRelationshipTypeModalTab("object2")}
              >
                Object 2
              </button>
              <button
                type="button"
                className={`segmented-control-option ${relationshipTypeModalTab === "attributes" ? "segmented-control-option--active" : ""}`}
                onClick={() => setRelationshipTypeModalTab("attributes")}
              >
                Attributes
              </button>
              <button
                type="button"
                className={`segmented-control-option ${relationshipTypeModalTab === "timeline" ? "segmented-control-option--active" : ""}`}
                onClick={() => setRelationshipTypeModalTab("timeline")}
              >
                Timeline
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
                    outlineColor: normalizeOptionalPostgresObjectTypeColor(objectType.outlineColor) || normalizePostgresObjectTypeColor(objectType.color),
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
                    outlineColor: normalizeOptionalPostgresObjectTypeColor(objectType.outlineColor) || normalizePostgresObjectTypeColor(objectType.color),
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
            ) : relationshipTypeModalTab === "timeline" ? (
              renderTimelineFieldMappingRows(
                relationshipTypeAttributeDrafts,
                (role, value) => updateTimelineFieldDrafts(
                  role,
                  value,
                  setRelationshipTypeAttributeDrafts,
                  (draft) => {
                    setTypeAttributeModalError("");
                    setRelationshipTypeAttributeModalDraft(draft);
                  },
                ),
              )
            ) : (
              <EditableAttributesMatrix
                definitions={relationshipTypeAttributeDrafts.map((draft) => ({
                  id: draft.localId,
                  name: draft.name || "Untitled attribute",
                  dataType: draft.dataType,
                  description: draft.description,
                  options: draft.options,
                }))}
                rows={relationshipTypeMatrixRows}
                values={relationshipTypeAttributeValuesByDraftId}
                disabled={graphSubmitting}
                emptyDefinitionsLabel="No attributes for this relationship type yet."
                emptyRowsLabel="No relationships of this type yet."
                onAddAttribute={openNewRelationshipTypeAttributeModal}
                onEditAttribute={(localId) => {
                  const draft = relationshipTypeAttributeDrafts.find((entry) => entry.localId === localId);
                  if (draft) openEditRelationshipTypeAttributeModal(draft);
                }}
                onDeleteAttribute={deleteRelationshipTypeAttributeDraft}
                onChangeValue={updateRelationshipTypeMatrixValue}
              />
            )}
            <div className="app-settings-modal-footer">
              <button type="button" className="btn" onClick={config.onClose} disabled={graphSubmitting}>
                Cancel
              </button>
              <button type="submit" className="btn btn--primary" disabled={graphSubmitting}>
                {graphSubmitting ? "Saving..." : config.submitLabel}
              </button>
            </div>
          </form>
      </SettingsModal>
    );
  }

  function updateTimelineFieldDrafts(
    role: TimelineFieldRole,
    value: string,
    setDrafts: Dispatch<SetStateAction<TypeAttributeDraft[]>>,
    openCreateDraft: (draft: TypeAttributeDraft) => void,
  ) {
    if (value === "__create__") {
      const option = TIMELINE_FIELD_OPTIONS.find((entry) => entry.role === role)!;
      openCreateDraft(createTypeAttributeDraft({
        name: option.defaultName,
        dataType: option.dataTypes[0],
        options: defaultTimelineAttributeOptions(role),
        timelineRole: role,
      }));
      return;
    }
    setDrafts((current) => current.map((draft) => ({
      ...draft,
      timelineRole: draft.localId === value ? role : draft.timelineRole === role ? "" : draft.timelineRole,
    })));
  }

  function renderTimelineFieldMappingRows(
    drafts: TypeAttributeDraft[],
    onChange: (role: TimelineFieldRole, value: string) => void,
  ) {
    return (
      <div className="postgres-attribute-modal-section">
        <div className="postgres-attribute-modal-title">Timeline Fields</div>
        <div className="case-detail-attributes-table-wrap">
          <table className="case-detail-attributes-table">
            <tbody>
              {TIMELINE_FIELD_OPTIONS.map((field) => {
                const selectedDraft = drafts.find((draft) => draft.timelineRole === field.role);
                const eligibleDrafts = drafts
                  .filter((draft) => field.dataTypes.includes(draft.dataType))
                  .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
                return (
                  <tr key={field.role}>
                    <th className="case-detail-attributes-label" scope="row">{field.label}</th>
                    <td className="case-detail-attributes-value">
                      <select
                        className="form-input"
                        value={selectedDraft?.localId ?? ""}
                        onChange={(event) => onChange(field.role, event.target.value)}
                      >
                        <option value="">None</option>
                        {eligibleDrafts.map((draft) => (
                          <option key={draft.localId} value={draft.localId}>{draft.name || "Untitled attribute"}</option>
                        ))}
                        <option value="__create__">Create new attribute...</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderObjectModal(config: {
    title: string;
    ariaLabel: string;
    tab: "details" | "graphics" | "attributes" | "timeline";
    setTab: Dispatch<SetStateAction<"details" | "graphics" | "attributes" | "timeline">>;
    submitLabel: string;
    objectTypeId: string;
    titleValue: string;
    descriptionValue: string;
    colorOverride: string;
    outlineColorOverride: string;
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
    setOutlineColorOverride: Dispatch<SetStateAction<string>>;
    setShapeOverride: Dispatch<SetStateAction<string>>;
    setFillOverride: Dispatch<SetStateAction<string>>;
    setImageStoragePath: Dispatch<SetStateAction<string>>;
    setGraphicMode: Dispatch<SetStateAction<PostgresObjectInstanceGraphicMode>>;
    setAttributeValues: Dispatch<SetStateAction<Record<string, string>>>;
    onImportImage?: () => void;
    onRemoveImage?: () => void;
    onClearPendingImage?: () => void;
    onNewObjectType?: () => void;
  }) {
    const inheritedColor = normalizePostgresObjectTypeColor(config.selectedType?.color || "");
    const inheritedOutlineColor = resolvePostgresObjectOutlineColor(
      { colorOverride: "", outlineColorOverride: "" },
      config.selectedType,
    );
    const effectiveColor = resolvePostgresObjectColor({ colorOverride: config.colorOverride }, config.selectedType);
    const effectiveOutlineColor = resolvePostgresObjectOutlineColor(
      { colorOverride: config.colorOverride, outlineColorOverride: config.outlineColorOverride },
      config.selectedType,
    );
    const colorInherited = !config.colorOverride.trim();
    const outlineColorInherited = !config.outlineColorOverride.trim();
    const inheritedShape = resolvePostgresObjectShape({ shapeOverride: "" }, config.selectedType);
    const effectiveShape = resolvePostgresObjectShape({ shapeOverride: config.shapeOverride }, config.selectedType);
    const inheritedFill = resolvePostgresObjectFill({ fillOverride: "" }, config.selectedType);
    const effectiveFill = resolvePostgresObjectFill({ fillOverride: config.fillOverride }, config.selectedType);
    const effectiveImageStoragePath = config.imageStoragePath || config.selectedType?.imageStoragePath || "";
    const timelineAttributeDefinitions = config.attributeDefinitions.filter((definition) => (definition.timelineRole ?? "").trim());

    return (
      <SettingsModal
        title={config.title}
        onClose={config.onClose}
        closeDisabled={graphSubmitting}
        modalClassName="modal--wide"
      >
          <form onSubmit={config.onSubmit} className="form app-settings-modal-body">
            <div className="segmented-control modal-segmented-control" role="tablist" aria-label={config.ariaLabel}>
              <button
                type="button"
                className={`segmented-control-option ${config.tab === "details" ? "segmented-control-option--active" : ""}`}
                onClick={() => config.setTab("details")}
              >
                Details
              </button>
              <button
                type="button"
                className={`segmented-control-option ${config.tab === "graphics" ? "segmented-control-option--active" : ""}`}
                onClick={() => config.setTab("graphics")}
              >
                Graphics
              </button>
              <button
                type="button"
                className={`segmented-control-option ${config.tab === "attributes" ? "segmented-control-option--active" : ""}`}
                onClick={() => config.setTab("attributes")}
              >
                Attributes
              </button>
              <button
                type="button"
                className={`segmented-control-option ${config.tab === "timeline" ? "segmented-control-option--active" : ""}`}
                onClick={() => config.setTab("timeline")}
              >
                Timeline
              </button>
            </div>
            {config.tab === "details" ? (
              <>
                <label className="form-label">
                  Object type
                  <select
                    className="form-input"
                    value={config.objectTypeId}
                    onChange={(event) => {
                      if (event.target.value === "__new_object_type__") {
                        config.onNewObjectType?.();
                        return;
                      }
                      config.setObjectTypeId(event.target.value);
                    }}
                    autoFocus
                  >
                    <option value="" disabled>Select an object type</option>
                    {objectTypes.map((objectType) => (
                      <option key={objectType.id} value={objectType.id}>{objectType.name}</option>
                    ))}
                    {config.onNewObjectType ? (
                      <option value="__new_object_type__">Add new object type...</option>
                    ) : null}
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
                  <div className="segmented-control modal-segmented-control modal-secondary-segmented-control modal-secondary-segmented-control--three" role="tablist" aria-label="Object graphic source">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={config.graphicMode === "inherit"}
                      className={`segmented-control-option ${config.graphicMode === "inherit" ? "segmented-control-option--active" : ""}`}
                      onClick={() =>
                        handleSetObjectGraphicMode("inherit", {
                          setMode: config.setGraphicMode,
                          setShapeOverride: config.setShapeOverride,
                          setColorOverride: config.setColorOverride,
                          setOutlineColorOverride: config.setOutlineColorOverride,
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
                      className={`segmented-control-option ${config.graphicMode === "select" ? "segmented-control-option--active" : ""}`}
                      onClick={() =>
                        handleSetObjectGraphicMode("select", {
                          setMode: config.setGraphicMode,
                          setShapeOverride: config.setShapeOverride,
                          setColorOverride: config.setColorOverride,
                          setOutlineColorOverride: config.setOutlineColorOverride,
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
                      className={`segmented-control-option ${config.graphicMode === "upload" ? "segmented-control-option--active" : ""}`}
                      onClick={() =>
                        handleSetObjectGraphicMode("upload", {
                          setMode: config.setGraphicMode,
                          setShapeOverride: config.setShapeOverride,
                          setColorOverride: config.setColorOverride,
                          setOutlineColorOverride: config.setOutlineColorOverride,
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
                  <>
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
                            outlineColor={effectiveOutlineColor}
                            sourceVisualKey={getPostgresSourceObjectVisualKey(config.selectedType?.systemKey)}
                            width={56}
                            minHeight={44}
                          />
                        )}
                      />
                    </label>
                    <label className="form-label">
                      Outline
                      <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
                        <input
                          className="form-input form-input--color"
                          type="color"
                          value={effectiveOutlineColor}
                          onChange={(event) => config.setOutlineColorOverride(event.target.value)}
                          style={{ width: 92, minWidth: 92, height: 56 }}
                        />
                        <input
                          className="form-input"
                          value={outlineColorInherited ? inheritedOutlineColor : config.outlineColorOverride}
                          onChange={(event) => config.setOutlineColorOverride(event.target.value)}
                          style={{ flex: "0 0 148px", fontFamily: "monospace" }}
                        />
                      </div>
                    </label>
                  </>
                ) : (
                  <>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                        gap: 14,
                      }}
                    >
                      <label className="form-label">
                        Fill
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
                            style={{ flex: "1 1 132px", minWidth: 0, fontFamily: "monospace" }}
                          />
                        </div>
                      </label>
                      <label className="form-label">
                        Outline
                        <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
                          <input
                            className="form-input form-input--color"
                            type="color"
                            value={effectiveOutlineColor}
                            onChange={(event) => config.setOutlineColorOverride(event.target.value)}
                            style={{ width: 92, minWidth: 92, height: 56 }}
                          />
                          <input
                            className="form-input"
                            value={outlineColorInherited ? inheritedOutlineColor : config.outlineColorOverride}
                            onChange={(event) => config.setOutlineColorOverride(event.target.value)}
                            style={{ flex: "1 1 132px", minWidth: 0, fontFamily: "monospace" }}
                          />
                        </div>
                      </label>
                    </div>
                    <label className="form-label">
                      Fill Style
                      <PostgresObjectFillPicker
                        value={effectiveFill}
                        onChange={(value) => config.setFillOverride(value === inheritedFill ? "" : value)}
                        previewColor={effectiveColor}
                        previewOutlineColor={effectiveOutlineColor}
                        previewShape={effectiveShape}
                      />
                    </label>
                    <label className="form-label">
                      Shape
                      <PostgresObjectShapePicker
                        value={effectiveShape}
                        onChange={(value) => config.setShapeOverride(value === inheritedShape ? "" : value)}
                        previewColor={effectiveColor}
                        previewOutlineColor={effectiveOutlineColor}
                        previewFill={effectiveFill}
                      />
                    </label>
                  </>
                )}
              </>
            ) : config.tab === "timeline" ? (
              timelineAttributeDefinitions.length > 0 ? (
                <div className="case-detail-attributes-table-wrap">
                  <table className="case-detail-attributes-table">
                    <tbody>
                      {timelineAttributeDefinitions.map((definition) => (
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
                  No timeline fields have been configured for this object type yet.
                </p>
              )
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
            <div className="app-settings-modal-footer">
              <button type="button" className="btn" onClick={config.onClose} disabled={graphSubmitting}>
                Cancel
              </button>
              <button type="submit" className="btn btn--primary" disabled={graphSubmitting}>
                {graphSubmitting ? "Saving..." : config.submitLabel}
              </button>
            </div>
          </form>
      </SettingsModal>
    );
  }

  function renderCreateObjectTypeModal() {
    const effectiveObjectTypeOutlineColor =
      normalizeOptionalPostgresObjectTypeColor(draftObjectTypeOutlineColor)
      || normalizePostgresObjectTypeColor(draftObjectTypeColor);
    return (
      <SettingsModal
        title="Add object type"
        subtitle="Create a project-specific object type now, then add objects to it whenever you are ready."
        onClose={() => setCreateObjectTypeOpen(false)}
        closeDisabled={graphSubmitting}
        modalClassName="modal--wide"
      >
          <form onSubmit={handleCreateObjectType} className="form app-settings-modal-body">
            <div className="segmented-control modal-segmented-control" role="tablist" aria-label="Add object type tabs">
              {(["details", "graphics", "attributes", "timeline"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`segmented-control-option ${objectTypeModalTab === tab ? "segmented-control-option--active" : ""}`}
                  onClick={() => setObjectTypeModalTab(tab)}
                >
                  {tab.slice(0, 1).toUpperCase() + tab.slice(1)}
                </button>
              ))}
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
                        outlineColor={effectiveObjectTypeOutlineColor}
                        width={56}
                        minHeight={44}
                      />
                    )}
                  />
                </label>
                {draftObjectTypeGraphicMode === "upload" ? (
                  <label className="form-label">
                    Outline
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
                      <input
                        className="form-input form-input--color"
                        type="color"
                        value={effectiveObjectTypeOutlineColor}
                        onChange={(event) => setDraftObjectTypeOutlineColor(event.target.value)}
                        style={{ width: 92, minWidth: 92, height: 56 }}
                      />
                      <input
                        className="form-input"
                        value={draftObjectTypeOutlineColor || effectiveObjectTypeOutlineColor}
                        onChange={(event) => setDraftObjectTypeOutlineColor(event.target.value)}
                        style={{ flex: "0 0 132px", fontFamily: "monospace" }}
                      />
                    </div>
                  </label>
                ) : null}
                {draftObjectTypeGraphicMode === "select" ? (
                  <>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                        gap: 14,
                      }}
                    >
                      <label className="form-label">
                        Fill
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
                            style={{ flex: "1 1 132px", minWidth: 0, fontFamily: "monospace" }}
                          />
                        </div>
                      </label>
                      <label className="form-label">
                        Outline
                        <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
                          <input
                            className="form-input form-input--color"
                            type="color"
                            value={effectiveObjectTypeOutlineColor}
                            onChange={(event) => setDraftObjectTypeOutlineColor(event.target.value)}
                            style={{ width: 92, minWidth: 92, height: 56 }}
                          />
                          <input
                            className="form-input"
                            value={draftObjectTypeOutlineColor || effectiveObjectTypeOutlineColor}
                            onChange={(event) => setDraftObjectTypeOutlineColor(event.target.value)}
                            style={{ flex: "1 1 132px", minWidth: 0, fontFamily: "monospace" }}
                          />
                        </div>
                      </label>
                    </div>
                    <label className="form-label">
                      Fill Style
                      <PostgresObjectFillPicker
                        value={draftObjectTypeFill}
                        onChange={(value) => setDraftObjectTypeFill((value || "filled") as PostgresObjectFill)}
                        previewColor={draftObjectTypeColor}
                        previewOutlineColor={effectiveObjectTypeOutlineColor}
                        previewShape={draftObjectTypeShape}
                      />
                    </label>
                    <label className="form-label">
                      Shape
                      <PostgresObjectShapePicker
                        value={draftObjectTypeShape}
                        onChange={(value) => setDraftObjectTypeShape((value || "rounded") as PostgresObjectTypeShape)}
                        previewColor={draftObjectTypeColor}
                        previewOutlineColor={effectiveObjectTypeOutlineColor}
                        previewFill={draftObjectTypeFill}
                      />
                    </label>
                  </>
                ) : null}
              </>
            ) : objectTypeModalTab === "timeline" ? (
              renderTimelineFieldMappingRows(
                objectTypeAttributeDrafts,
                (role, value) => updateTimelineFieldDrafts(
                  role,
                  value,
                  setObjectTypeAttributeDrafts,
                  (draft) => {
                    setTypeAttributeModalError("");
                    setObjectTypeAttributeModalDraft(draft);
                  },
                ),
              )
            ) : (
              <EditableAttributesMatrix
                definitions={objectTypeAttributeDrafts.map((draft) => ({
                  id: draft.localId,
                  name: draft.name || "Untitled attribute",
                  dataType: draft.dataType,
                  description: draft.description,
                  options: draft.options,
                }))}
                rows={[]}
                values={objectTypeAttributeValuesByDraftId}
                disabled={graphSubmitting}
                emptyDefinitionsLabel="No attributes for this object type yet."
                emptyRowsLabel="Create the object type before assigning values."
                onAddAttribute={openNewObjectTypeAttributeModal}
                onEditAttribute={(localId) => {
                  const draft = objectTypeAttributeDrafts.find((entry) => entry.localId === localId);
                  if (draft) openEditObjectTypeAttributeModal(draft);
                }}
                onDeleteAttribute={deleteObjectTypeAttributeDraft}
                onChangeValue={updateObjectTypeMatrixValue}
              />
            )}
            <div className="app-settings-modal-footer">
              <button type="button" className="btn" onClick={() => setCreateObjectTypeOpen(false)} disabled={graphSubmitting}>
                Cancel
              </button>
              <button type="submit" className="btn btn--primary" disabled={graphSubmitting}>
                {graphSubmitting ? "Saving..." : "Create object type"}
              </button>
            </div>
          </form>
      </SettingsModal>
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
    const nextDraft = objectTypeAttributeModalDraft
      ? { ...objectTypeAttributeModalDraft, ...draft }
      : createTypeAttributeDraft(draft);
    setObjectTypeAttributeDrafts((current) => {
      if (objectTypeAttributeModalDraft && current.some((entry) => entry.localId === objectTypeAttributeModalDraft.localId)) {
        return current.map((entry) =>
          entry.localId === objectTypeAttributeModalDraft.localId ? nextDraft : entry,
        );
      }
      return [...current, nextDraft];
    });
    setObjectTypeAttributeValuesByDraftId((values) => (
      values[nextDraft.localId] ? values : { ...values, [nextDraft.localId]: {} }
    ));
    setObjectTypeAttributeModalDraft(null);
    setTypeAttributeModalError("");
  }

  function deleteObjectTypeAttributeDraft(localId: string) {
    setObjectTypeAttributeDrafts((current) => current.filter((entry) => entry.localId !== localId));
    setObjectTypeAttributeValuesByDraftId((current) => {
      const next = { ...current };
      delete next[localId];
      return next;
    });
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
    const nextDraft = relationshipTypeAttributeModalDraft
      ? { ...relationshipTypeAttributeModalDraft, ...draft }
      : createTypeAttributeDraft(draft);
    setRelationshipTypeAttributeDrafts((current) => {
      if (relationshipTypeAttributeModalDraft && current.some((entry) => entry.localId === relationshipTypeAttributeModalDraft.localId)) {
        return current.map((entry) =>
          entry.localId === relationshipTypeAttributeModalDraft.localId ? nextDraft : entry,
        );
      }
      return [...current, nextDraft];
    });
    setRelationshipTypeAttributeValuesByDraftId((values) => (
      values[nextDraft.localId] ? values : { ...values, [nextDraft.localId]: {} }
    ));
    setRelationshipTypeAttributeModalDraft(null);
    setTypeAttributeModalError("");
  }

  function deleteRelationshipTypeAttributeDraft(localId: string) {
    setRelationshipTypeAttributeDrafts((current) => current.filter((entry) => entry.localId !== localId));
    setRelationshipTypeAttributeValuesByDraftId((current) => {
      const next = { ...current };
      delete next[localId];
      return next;
    });
  }

  function updateObjectTypeMatrixValue(attributeLocalId: string, objectId: string, value: string) {
    setObjectTypeAttributeValuesByDraftId((current) => ({
      ...current,
      [attributeLocalId]: {
        ...(current[attributeLocalId] ?? {}),
        [objectId]: value,
      },
    }));
  }

  function updateRelationshipTypeMatrixValue(attributeLocalId: string, relationshipId: string, value: string) {
    setRelationshipTypeAttributeValuesByDraftId((current) => ({
      ...current,
      [attributeLocalId]: {
        ...(current[attributeLocalId] ?? {}),
        [relationshipId]: value,
      },
    }));
  }

  const currentProjectUser = users.find((user) => user.appUserId === authSession.user.id) ?? null;
  const isProjectAdmin = authSession.authKind === "postgres_admin";
  const canManageProjectSettings = isProjectAdmin || currentProjectUser?.role === "owner";
  const canEditProjectMetadata = canManageProjectSettings || currentProjectUser?.role === "editor";
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
  const canManageSources = isProjectAdmin || currentProjectUser?.role === "owner" || currentProjectUser?.role === "editor";
  const canManageAnnotations = isProjectAdmin || currentProjectUser?.role === "owner" || currentProjectUser?.role === "editor" || currentProjectUser?.role === "coder";
  const canDeleteHomeCanvasItems = isProjectAdmin || currentProjectUser?.role === "owner" || currentProjectUser?.role === "editor";
  const canManageMemos = canManageAnnotations;
  const homeCanvasSectionEnabled = useCallback(
    (section: PostgresHomeCanvasSection) => homeCanvasEnabledSections.has(section),
    [homeCanvasEnabledSections],
  );
  const showHomeCanvasSection = useCallback((section: PostgresHomeCanvasSection) => {
    setHomeCanvasEnabledSections((current) => {
      if (current.has(section)) return current;
      const next = new Set(current);
      next.add(section);
      return next;
    });
  }, []);
  const clearHomeCanvasSection = useCallback((section: PostgresHomeCanvasSection) => {
    setHomeCanvasEnabledSections((current) => {
      if (!current.has(section)) return current;
      const next = new Set(current);
      next.delete(section);
      return next;
    });
  }, []);
  const toggleHomeCanvasSectionCollapsed = useCallback((section: PostgresHomeCanvasSection) => {
    setHomeCanvasCollapsedSections((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }, []);
  const homeCanvasSourceKindSummaries = useMemo(() => {
    const counts = new Map<string, number>();
    sources.forEach((source) => counts.set(source.sourceKind || "unknown", (counts.get(source.sourceKind || "unknown") ?? 0) + 1));
    return Array.from(counts.entries())
      .map(([id, count]) => ({ id, label: formatPostgresSourceKindLabel(id), count }))
      .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" }));
  }, [sources]);
  const homeCanvasCodeSummaries = useMemo(
    () => codes
      .map((code) => ({
        id: code.id,
        label: code.label || "Untitled code",
        count: annotationSummaries.filter((annotation) => annotation.codeIds.includes(code.id)).length,
      }))
      .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" })),
    [annotationSummaries, codes],
  );
  const allHomeCanvasSourceKinds = useMemo(() => homeCanvasSourceKindSummaries.map((summary) => summary.id), [homeCanvasSourceKindSummaries]);
  const allHomeCanvasObjectTypeIds = useMemo(() => objectTypeSummaries.map((summary) => summary.objectTypeId), [objectTypeSummaries]);
  const allHomeCanvasRelationshipTypeIds = useMemo(() => relationshipTypeSummaries.map((summary) => summary.relationshipTypeId), [relationshipTypeSummaries]);
  const allHomeCanvasCodeIds = useMemo(() => homeCanvasCodeSummaries.map((summary) => summary.id), [homeCanvasCodeSummaries]);
  const visibleHomeCanvasSourceKinds = useMemo(() => selectedSetOrAll(homeCanvasSourceKinds, allHomeCanvasSourceKinds), [allHomeCanvasSourceKinds, homeCanvasSourceKinds]);
  const visibleHomeCanvasObjectTypeIds = useMemo(() => selectedSetOrAll(homeCanvasObjectTypeIds, allHomeCanvasObjectTypeIds), [allHomeCanvasObjectTypeIds, homeCanvasObjectTypeIds]);
  const visibleHomeCanvasRelationshipTypeIds = useMemo(() => selectedSetOrAll(homeCanvasRelationshipTypeIds, allHomeCanvasRelationshipTypeIds), [allHomeCanvasRelationshipTypeIds, homeCanvasRelationshipTypeIds]);
  const visibleHomeCanvasCodeIds = useMemo(() => selectedSetOrAll(homeCanvasCodeIds, allHomeCanvasCodeIds), [allHomeCanvasCodeIds, homeCanvasCodeIds]);
  const homeCanvasFilteringActive = useMemo(() => {
    const allSections: PostgresHomeCanvasSection[] = ["sources", "objects", "relationships", "codes", "annotations"];
    return allSections.some((section) => !homeCanvasEnabledSections.has(section))
      || isHomeCanvasSelectionFiltered(homeCanvasSourceKinds, allHomeCanvasSourceKinds)
      || isHomeCanvasSelectionFiltered(homeCanvasObjectTypeIds, allHomeCanvasObjectTypeIds)
      || isHomeCanvasSelectionFiltered(homeCanvasRelationshipTypeIds, allHomeCanvasRelationshipTypeIds)
      || isHomeCanvasSelectionFiltered(homeCanvasCodeIds, allHomeCanvasCodeIds);
  }, [
    allHomeCanvasCodeIds,
    allHomeCanvasObjectTypeIds,
    allHomeCanvasRelationshipTypeIds,
    allHomeCanvasSourceKinds,
    homeCanvasCodeIds,
    homeCanvasEnabledSections,
    homeCanvasObjectTypeIds,
    homeCanvasRelationshipTypeIds,
    homeCanvasSourceKinds,
  ]);
  const homeCanvasVirtualObjectTypes = useMemo<PostgresObjectType[]>(() => [
    ...POSTGRES_SOURCE_KIND_OPTIONS.map((option) => ({
      id: `__home_canvas_source:${option.sourceVisualKey}`,
      projectId: project.id,
      systemKey: option.sourceVisualKey,
      name: option.label,
      description: "",
      shape: "rectangle" as PostgresObjectTypeShape,
      color: option.color,
      outlineColor: option.color,
      fill: "outline" as PostgresObjectFill,
      imageStoragePath: "",
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    })),
    {
      id: "__home_canvas_source",
      projectId: project.id,
      systemKey: "home_canvas_source",
      name: "Source",
      description: "",
      shape: "rectangle",
      color: "#2f6f73",
      outlineColor: "#2f6f73",
      fill: "outline",
      imageStoragePath: "",
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
    {
      id: "__home_canvas_code",
      projectId: project.id,
      systemKey: "home_canvas_code",
      name: "Code",
      description: "",
      shape: "tag",
      color: "#8a5a44",
      outlineColor: "#8a5a44",
      fill: "outline",
      imageStoragePath: "",
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
  ], [project.createdAt, project.id, project.updatedAt]);
  const homeCanvasObjects = useMemo<PostgresObject[]>(() => {
    const nextObjects: PostgresObject[] = [];
    if (homeCanvasSectionEnabled("objects")) {
      nextObjects.push(...objects.filter((object) => visibleHomeCanvasObjectTypeIds.has(object.objectTypeId)));
    }
    if (homeCanvasSectionEnabled("sources")) {
      nextObjects.push(...sources
        .filter((source) => visibleHomeCanvasSourceKinds.has(source.sourceKind || "unknown"))
        .map((source) => ({
          id: source.id,
          projectId: source.projectId,
          objectTypeId: getHomeCanvasSourceObjectTypeId(source.sourceKind),
          objectType: formatPostgresSourceKindLabel(source.sourceKind),
          objectTypeSystemKey: getPostgresSourceKindOption(source.sourceKind)?.sourceVisualKey ?? "home_canvas_source",
          title: source.title || source.originalFileName || "Untitled source",
          description: source.notes || "",
          shapeOverride: "",
          colorOverride: "",
          outlineColorOverride: "",
          fillOverride: "",
          imageStoragePath: "",
          eventStartAt: null,
          eventEndAt: null,
          eventTimePrecision: null,
          eventTimezone: null,
          eventIsInstant: null,
          attributeValues: [],
          createdAt: source.createdAt,
          updatedAt: source.updatedAt,
        })));
    }
    if (homeCanvasSectionEnabled("codes")) {
      nextObjects.push(...codes
        .filter((code) => visibleHomeCanvasCodeIds.has(code.id))
        .map((code) => ({
          id: code.id,
          projectId: code.projectId,
          objectTypeId: "__home_canvas_code",
          objectType: "Code",
          objectTypeSystemKey: "home_canvas_code",
          title: code.label || "Untitled code",
          description: code.description || "",
          shapeOverride: "",
          colorOverride: code.color || "",
          outlineColorOverride: code.color || "",
          fillOverride: "",
          imageStoragePath: "",
          eventStartAt: null,
          eventEndAt: null,
          eventTimePrecision: null,
          eventTimezone: null,
          eventIsInstant: null,
          attributeValues: [],
          createdAt: code.createdAt,
          updatedAt: code.updatedAt,
        })));
    }
    return nextObjects;
  }, [codes, homeCanvasSectionEnabled, objects, sources, visibleHomeCanvasCodeIds, visibleHomeCanvasObjectTypeIds, visibleHomeCanvasSourceKinds]);
  const resizeHomeCanvasNodeGroup = useCallback((nodeIds: string[], scale: number) => {
    const targetIds = new Set(nodeIds);
    if (targetIds.size === 0) return;
    const homeObjectById = new Map(homeCanvasObjects.map((object) => [object.id, object]));
    const homeObjectTypeById = new Map([...objectTypes, ...homeCanvasVirtualObjectTypes].map((objectType) => [objectType.id, objectType]));
    setCanvasNodes((current) => {
      let changed = false;
      const next = { ...current };
      targetIds.forEach((nodeId) => {
        const object = homeObjectById.get(nodeId);
        const currentNode = current[nodeId];
        if (!object || !currentNode) return;
        const objectTypeRecord = homeObjectTypeById.get(object.objectTypeId) ?? null;
        const appearance = getPostgresObjectAppearance(object, objectTypeRecord);
        const defaultDimensions = appearance.sourceImage
          ? getSourceCanvasNodeDefaultDimensions()
          : getCanvasNodeDefaultDimensions(appearance.shape);
        const width = Math.round(defaultDimensions.width * scale);
        const height = Math.round(defaultDimensions.height * scale);
        if (currentNode.width === width && currentNode.height === height) return;
        const centerX = currentNode.x + currentNode.width / 2;
        const centerY = currentNode.y + currentNode.height / 2;
        next[nodeId] = {
          ...currentNode,
          x: centerX - width / 2,
          y: centerY - height / 2,
          width,
          height,
        };
        changed = true;
      });
      return changed ? next : current;
    });
  }, [homeCanvasObjects, homeCanvasVirtualObjectTypes, objectTypes]);
  const getHomeCanvasNodeGroupSizePercent = useCallback((nodeIds: string[]) => {
    if (nodeIds.length === 0) return 100;
    const homeObjectById = new Map(homeCanvasObjects.map((object) => [object.id, object]));
    const homeObjectTypeById = new Map([...objectTypes, ...homeCanvasVirtualObjectTypes].map((objectType) => [objectType.id, objectType]));
    const percents = nodeIds.flatMap((nodeId) => {
      const object = homeObjectById.get(nodeId);
      const node = canvasNodes[nodeId];
      if (!object || !node) return [];
      const objectTypeRecord = homeObjectTypeById.get(object.objectTypeId) ?? null;
      const appearance = getPostgresObjectAppearance(object, objectTypeRecord);
      const defaultDimensions = appearance.sourceImage
        ? getSourceCanvasNodeDefaultDimensions()
        : getCanvasNodeDefaultDimensions(appearance.shape);
      if (defaultDimensions.width <= 0) return [];
      return Math.round((node.width / defaultDimensions.width) * 100);
    });
    if (percents.length === 0) return 100;
    const average = Math.round(percents.reduce((total, percent) => total + percent, 0) / percents.length);
    return Math.max(10, Math.min(300, Math.round(average / 5) * 5));
  }, [canvasNodes, homeCanvasObjects, homeCanvasVirtualObjectTypes, objectTypes]);
  const homeCanvasRenderedObjectIds = useMemo(
    () => new Set(homeCanvasObjects.map((object) => object.id)),
    [homeCanvasObjects],
  );
  const homeCanvasSourceSizeRows = useMemo(
    () => homeCanvasSourceKindSummaries
      .map((summary) => {
        const nodeIds = sources
          .filter((source) => (source.sourceKind || "unknown") === summary.id)
          .map((source) => source.id)
          .filter((sourceId) => homeCanvasRenderedObjectIds.has(sourceId));
        return {
          id: `source:${summary.id}`,
          label: summary.label,
          count: nodeIds.length,
          nodeIds,
          sizePercent: getHomeCanvasNodeGroupSizePercent(nodeIds),
        };
      })
      .filter((row) => row.count > 0),
    [getHomeCanvasNodeGroupSizePercent, homeCanvasRenderedObjectIds, homeCanvasSourceKindSummaries, sources],
  );
  const homeCanvasObjectSizeRows = useMemo(
    () => objectTypeSummaries
      .map((summary) => {
        const objectTypeRecord = objectTypes.find((objectType) => objectType.id === summary.objectTypeId);
        const nodeIds = objects
          .filter((object) => object.objectTypeId === summary.objectTypeId)
          .map((object) => object.id)
          .filter((objectId) => homeCanvasRenderedObjectIds.has(objectId));
        return {
          id: `object:${summary.objectTypeId}`,
          label: objectTypeRecord?.name || summary.objectType || "Objects",
          count: nodeIds.length,
          nodeIds,
          sizePercent: getHomeCanvasNodeGroupSizePercent(nodeIds),
        };
      })
      .filter((row) => row.count > 0),
    [getHomeCanvasNodeGroupSizePercent, homeCanvasRenderedObjectIds, objectTypeSummaries, objectTypes, objects],
  );
  const homeCanvasCodeSizeRows = useMemo(() => {
    const nodeIds = codes
      .map((code) => code.id)
      .filter((codeId) => homeCanvasRenderedObjectIds.has(codeId));
    return nodeIds.length > 0
      ? [{ id: "code:all", label: "All codes", count: nodeIds.length, nodeIds, sizePercent: getHomeCanvasNodeGroupSizePercent(nodeIds) }]
      : [];
  }, [codes, getHomeCanvasNodeGroupSizePercent, homeCanvasRenderedObjectIds]);
  const homeCanvasSizeGroupCount = homeCanvasSourceSizeRows.length + homeCanvasObjectSizeRows.length + homeCanvasCodeSizeRows.length;
  const homeCanvasCustomSizesActive = [...homeCanvasSourceSizeRows, ...homeCanvasObjectSizeRows, ...homeCanvasCodeSizeRows]
    .some((row) => row.sizePercent !== 100);
  const resetAllHomeCanvasNodeSizes = useCallback(() => {
    const nodeIds = [
      ...homeCanvasSourceSizeRows.flatMap((row) => row.nodeIds),
      ...homeCanvasObjectSizeRows.flatMap((row) => row.nodeIds),
      ...homeCanvasCodeSizeRows.flatMap((row) => row.nodeIds),
    ];
    resizeHomeCanvasNodeGroup(nodeIds, 1);
  }, [homeCanvasCodeSizeRows, homeCanvasObjectSizeRows, homeCanvasSourceSizeRows, resizeHomeCanvasNodeGroup]);
  const toggleHomeCanvasSizeSectionCollapsed = useCallback((section: PostgresHomeCanvasSizeSectionKey) => {
    setHomeCanvasSizeCollapsedSections((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }, []);
  const homeCanvasRelationshipTypes = useMemo<PostgresRelationshipType[]>(() => [
    ...relationshipTypes,
    {
      id: "__home_canvas_annotation",
      projectId: project.id,
      name: "Annotation",
      description: "",
      lineShape: "dashed",
      lineWeight: 1,
      arrowhead: "one_sided",
      color: "#6d597a",
      fromObjectTypeIds: [],
      fromObjectTypes: [],
      toObjectTypeIds: [],
      toObjectTypes: [],
      fromSourceKinds: [],
      toSourceKinds: [],
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
  ], [project.createdAt, project.id, project.updatedAt, relationshipTypes]);
  const homeCanvasRelationships = useMemo<PostgresRelationship[]>(() => {
    const nextRelationships: PostgresRelationship[] = [];
    if (homeCanvasSectionEnabled("relationships")) {
      nextRelationships.push(...relationships
        .filter((relationship) => visibleHomeCanvasRelationshipTypeIds.has(relationship.relationshipTypeId))
        .map((relationship) => ({
          ...relationship,
          fromObjectId: relationship.fromEntityType === "source" ? relationship.fromEntityId : relationship.fromObjectId,
          toObjectId: relationship.toEntityType === "source" ? relationship.toEntityId : relationship.toObjectId,
        })));
    }
    if (homeCanvasSectionEnabled("annotations") && homeCanvasSectionEnabled("sources") && homeCanvasSectionEnabled("codes")) {
      annotationSummaries.forEach((annotation) => {
        if (!visibleHomeCanvasSourceKinds.has(annotation.sourceKind || "unknown")) return;
        const source = sources.find((entry) => entry.id === annotation.sourceId);
        annotation.codeIds.filter((codeId) => visibleHomeCanvasCodeIds.has(codeId)).forEach((codeId) => {
          const code = codes.find((entry) => entry.id === codeId);
          nextRelationships.push({
            id: `annotation:${annotation.id}:${codeId}`,
            projectId: annotation.projectId,
            fromObjectId: annotation.sourceId,
            toObjectId: codeId,
            fromEntityType: "source",
            fromEntityId: annotation.sourceId,
            toEntityType: "object",
            toEntityId: codeId,
            fromEntityName: source?.title || source?.originalFileName || "Source",
            toEntityName: code?.label ?? "Code",
            relationshipTypeId: "__home_canvas_annotation",
            relationshipType: `A${String(annotation.displayId).padStart(2, "0")}`,
            description: annotation.quote || annotation.note || "",
            lineShapeOverride: "",
            lineWeightOverride: null,
            arrowheadOverride: "",
            colorOverride: "",
            attributeValues: [],
            createdAt: annotation.createdAt,
            updatedAt: annotation.updatedAt,
          });
        });
      });
    }
    return nextRelationships;
  }, [annotationSummaries, codes, homeCanvasSectionEnabled, relationships, sources, visibleHomeCanvasCodeIds, visibleHomeCanvasRelationshipTypeIds, visibleHomeCanvasSourceKinds]);
  const handleHomeCanvasContextMenu = useCallback((context: {
    kind: "background" | "node" | "edge";
    id: string | null;
    clientX: number;
    clientY: number;
    canvasPosition: PostgresCanvasPoint | null;
  }) => {
    const x = Math.min(context.clientX, window.innerWidth - 190);
    const y = Math.min(context.clientY, window.innerHeight - 170);
    if (context.kind === "background") {
      setHomeCanvasContextMenu({
        kind: "background",
        id: null,
        x,
        y,
        canvasPosition: context.canvasPosition,
      });
      setHomeCanvasCreateMenuOpen(false);
      return;
    }

    const rawId = context.id ?? "";
    if (!rawId) return;
    if (context.kind === "edge") {
      if (rawId.startsWith("annotation:")) {
        const idParts = rawId.split(":");
        const annotationId = idParts[1] ?? "";
        setHomeCanvasContextMenu({
          kind: "annotation",
          id: annotationId,
          x,
          y,
          canvasPosition: context.canvasPosition,
        });
        return;
      }
      setHomeCanvasContextMenu({
        kind: "relationship",
        id: rawId,
        x,
        y,
        canvasPosition: context.canvasPosition,
      });
      return;
    }

    const canvasObject = homeCanvasObjects.find((object) => object.id === rawId);
    const systemKey = canvasObject?.objectTypeSystemKey ?? "";
    if (systemKey === "home_canvas_code") {
      setHomeCanvasContextMenu({
        kind: "code",
        id: rawId,
        x,
        y,
        canvasPosition: context.canvasPosition,
      });
      return;
    }
    if (systemKey === "home_canvas_annotation") {
      setHomeCanvasContextMenu({
        kind: "annotation",
        id: rawId,
        x,
        y,
        canvasPosition: context.canvasPosition,
      });
      return;
    }
    if (systemKey === "home_canvas_source" || isPostgresSourceObjectVisualKey(systemKey)) {
      setHomeCanvasContextMenu({
        kind: "source",
        id: rawId,
        x,
        y,
        canvasPosition: context.canvasPosition,
      });
      return;
    }
    setHomeCanvasContextMenu({
      kind: "object",
      id: rawId,
      x,
      y,
      canvasPosition: context.canvasPosition,
    });
  }, [homeCanvasObjects]);
  const handleHomeTimelineItemContextMenu = useCallback((context: {
    kind: "source" | "object" | "relationship";
    id: string;
    clientX: number;
    clientY: number;
  }) => {
    setHomeCanvasContextMenu({
      kind: context.kind,
      id: context.id,
      x: Math.min(context.clientX, window.innerWidth - 190),
      y: Math.min(context.clientY, window.innerHeight - 170),
      canvasPosition: null,
    });
    setHomeCanvasCreateMenuOpen(false);
  }, []);
  const toggleHomeCanvasSelection = useCallback((
    section: PostgresHomeCanvasSection,
    setSelection: Dispatch<SetStateAction<Set<string>>>,
    id: string,
    allIds: string[],
  ) => {
    showHomeCanvasSection(section);
    setSelection((current) => {
      const base = current.size === 0
        ? new Set(allIds)
        : current.has("__none")
          ? new Set<string>()
          : new Set(current);
      if (base.has(id)) base.delete(id);
      else base.add(id);
      if (base.size === allIds.length && allIds.every((value) => base.has(value))) return new Set();
      if (base.size === 0) return new Set(["__none"]);
      return base;
    });
  }, [showHomeCanvasSection]);
  const homeCanvasSourceRows = useMemo(
    () => homeCanvasSourceKindSummaries.map((summary) => ({
      ...summary,
      selected: homeCanvasSectionEnabled("sources") && visibleHomeCanvasSourceKinds.has(summary.id),
      indent: true,
      onClick: () => toggleHomeCanvasSelection("sources", setHomeCanvasSourceKinds, summary.id, allHomeCanvasSourceKinds),
    })),
    [allHomeCanvasSourceKinds, homeCanvasSectionEnabled, homeCanvasSourceKindSummaries, toggleHomeCanvasSelection, visibleHomeCanvasSourceKinds],
  );
  const homeCanvasObjectRows = useMemo(
    () => objectTypeSummaries.map((summary) => ({
      id: summary.objectTypeId,
      label: summary.objectType,
      count: summary.count,
      selected: homeCanvasSectionEnabled("objects") && visibleHomeCanvasObjectTypeIds.has(summary.objectTypeId),
      indent: true,
      onClick: () => toggleHomeCanvasSelection("objects", setHomeCanvasObjectTypeIds, summary.objectTypeId, allHomeCanvasObjectTypeIds),
    })),
    [allHomeCanvasObjectTypeIds, homeCanvasSectionEnabled, objectTypeSummaries, toggleHomeCanvasSelection, visibleHomeCanvasObjectTypeIds],
  );
  const homeCanvasRelationshipRows = useMemo(
    () => relationshipTypeSummaries.map((summary) => ({
      id: summary.relationshipTypeId,
      label: summary.relationshipType,
      count: summary.count,
      selected: homeCanvasSectionEnabled("relationships") && visibleHomeCanvasRelationshipTypeIds.has(summary.relationshipTypeId),
      indent: true,
      onClick: () => toggleHomeCanvasSelection("relationships", setHomeCanvasRelationshipTypeIds, summary.relationshipTypeId, allHomeCanvasRelationshipTypeIds),
    })),
    [allHomeCanvasRelationshipTypeIds, homeCanvasSectionEnabled, relationshipTypeSummaries, toggleHomeCanvasSelection, visibleHomeCanvasRelationshipTypeIds],
  );
  const homeCanvasCodeRows = useMemo(
    () => homeCanvasCodeSummaries.map((summary) => ({
      ...summary,
      selected: homeCanvasSectionEnabled("codes") && visibleHomeCanvasCodeIds.has(summary.id),
      indent: true,
      onClick: () => toggleHomeCanvasSelection("codes", setHomeCanvasCodeIds, summary.id, allHomeCanvasCodeIds),
    })),
    [allHomeCanvasCodeIds, homeCanvasCodeSummaries, homeCanvasSectionEnabled, toggleHomeCanvasSelection, visibleHomeCanvasCodeIds],
  );
  usePostgresAutomaticProjectSnapshots(project, canManageProjectSettings);

  useEffect(() => {
    function handleOpenProjectSettingsModal() {
      setActiveScreen("app-settings");
    }

    window.addEventListener(OPEN_PROJECT_SETTINGS_MODAL_EVENT, handleOpenProjectSettingsModal);
    return () => {
      window.removeEventListener(OPEN_PROJECT_SETTINGS_MODAL_EVENT, handleOpenProjectSettingsModal);
    };
  }, []);
  const sidebarCollaborationStatus: PostgresSidebarCollaborationStatus =
    !project
      ? "disabled"
      : sidebarNetworkMode === "network" || sidebarNetworkMode === "internet"
        ? "active-solo"
        : "idle";

  useEffect(() => {
    let cancelled = false;

    async function loadSourceImportSettings() {
      const appSettings = readAppSettings().documentImport;
      try {
        const projectSettings = await getPostgresProjectDocumentImportSettings(project.id);
        if (cancelled) return;
        setSourceImportSettings({
          defaultMode: appSettings.defaultMode,
          autoNameFromFile: appSettings.autoNameFromFile,
          trimImportedText: appSettings.trimImportedText,
          warnBeforeEmptyImport: appSettings.warnBeforeEmptyImport,
          storeOriginalFileName: projectSettings.storeOriginalFileName,
        });
      } catch {
        if (cancelled) return;
        setSourceImportSettings({
          defaultMode: appSettings.defaultMode,
          autoNameFromFile: appSettings.autoNameFromFile,
          trimImportedText: appSettings.trimImportedText,
          warnBeforeEmptyImport: appSettings.warnBeforeEmptyImport,
          storeOriginalFileName: true,
        });
      }
    }

    void loadSourceImportSettings();
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  useEffect(() => {
    let cancelled = false;

    async function refreshSidebarNetworkStatus() {
      try {
        const status = await getPostgresStatus();
        if (!cancelled) setSidebarNetworkMode(status.networkMode);
      } catch {
        if (!cancelled) setSidebarNetworkMode("unknown");
      }
    }

    void refreshSidebarNetworkStatus();
    const intervalId = window.setInterval(() => {
      void refreshSidebarNetworkStatus();
    }, 30000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshSidebarAiStatus() {
      try {
        const [settings, runtimeStatus, indexStatus, buildStatus] = await Promise.all([
          getPostgresProjectAiAssistSettings(project.id),
          getPostgresProjectAiAssistRuntimeStatus(project.id),
          invoke<ProjectEmbeddingStoreStatus>("get_project_embedding_store_status", { projectId: project.id }).catch(() => null),
          invoke<ProjectEmbeddingBuildStatus>("get_project_embedding_store_build_status").catch(() => null),
        ]);
        if (cancelled) return;
        const projectBuildRunning =
          buildStatus?.projectId === project.id
          && (buildStatus.phase === "running" || buildStatus.phase === "cancelling");
        if (projectBuildRunning) {
          setSidebarAiStatus("running");
        } else if (!settings.enabled) {
          setSidebarAiStatus("disabled");
        } else if (runtimeStatus.hostProjectEmbeddingsReady === true || indexStatus?.exists) {
          setSidebarAiStatus("ready");
        } else {
          setSidebarAiStatus("unavailable");
        }
      } catch {
        if (!cancelled) setSidebarAiStatus("unavailable");
      }
    }

    void refreshSidebarAiStatus();
    const intervalId = window.setInterval(() => {
      void refreshSidebarAiStatus();
    }, 30000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [project.id]);

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
      .filter((summary) => summary.count > 0)
      .sort((left, right) => {
        let comparison = 0;
        if (userRoleSortCol === "count") {
          comparison = left.count - right.count;
          if (comparison === 0) {
            comparison = left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
          }
        } else {
          comparison = left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
        }
        return userRoleSortDir === "asc" ? comparison : -comparison;
      }),
    [userRoleSortCol, userRoleSortDir, users],
  );

  const filteredProjectUsers = useMemo(
    () => selectedUserRoleFilter === "all"
      ? users
      : users.filter((user) => user.role === selectedUserRoleFilter),
    [selectedUserRoleFilter, users],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadUsers() {
      setUsersLoading(true);
      setUsersError("");
      try {
        const nextUsers = await listPostgresProjectUsers(project.id);
        if (!cancelled) {
          setUsers(nextUsers);
        }
      } catch (loadError) {
        if (!cancelled) {
          setUsers([]);
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
          nextSourceTypeSettings,
          nextRelationships,
          nextCodes,
          nextAnnotationSummaries,
          nextObjectAttributeDefinitions,
          nextRelationshipAttributeDefinitions,
          nextSavedDrawings,
          nextCanvasState,
          nextMemos,
          nextReports,
        ] = await Promise.all([
          listPostgresObjectTypes(project.id),
          listPostgresRelationshipTypes(project.id),
          listPostgresObjects(project.id),
          listPostgresSources(project.id),
          listPostgresSourceTypeSettings(project.id),
          listPostgresRelationships(project.id),
          listPostgresCodes(project.id),
          listPostgresAnnotationSummaries(project.id),
          listPostgresObjectAttributeDefinitions(project.id),
          listPostgresRelationshipAttributeDefinitions(project.id),
          listPostgresSavedDrawingSummaries(project.id),
          getPostgresProjectCanvasState(project.id),
          listPostgresMemos(project.id),
          listPostgresReports(project.id),
        ]);
        if (!cancelled) {
          setObjectTypes(nextObjectTypes);
          setRelationshipTypes(nextRelationshipTypes);
          setObjects(nextObjects);
          setSources(nextSources);
          setSourceTypeSettings(nextSourceTypeSettings);
          setRelationships(nextRelationships);
          setCodes(nextCodes);
          setAnnotationSummaries(nextAnnotationSummaries);
          setObjectAttributeDefinitions(nextObjectAttributeDefinitions);
          setRelationshipAttributeDefinitions(nextRelationshipAttributeDefinitions);
          setSavedDrawings(nextSavedDrawings);
          setMemoCount(nextMemos.length);
          setReportCount(nextReports.length);
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
        }
      } catch (loadError) {
        if (!cancelled) {
          setObjectTypes([]);
          setRelationshipTypes([]);
          setObjects([]);
          setSources([]);
          setSourceTypeSettings([]);
          setRelationships([]);
          setCodes([]);
          setAnnotationSummaries([]);
          setObjectAttributeDefinitions([]);
          setRelationshipAttributeDefinitions([]);
          setSavedDrawings([]);
          setMemoCount(0);
          setReportCount(0);
          setHiddenCanvasRelationshipIds([]);
          setCanvasStateLoaded(false);
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
    if (activeScreen !== "home" && activeScreen !== "explore") return;
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
      const nextUsers = await listPostgresProjectUsers(project.id);
      setUsers(nextUsers);
    } catch (loadError) {
      setUsers([]);
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
          ${renderSvgObjectShape(appearance.shape, nodeWidth, nodeHeight, appearance.color, appearance.outlineColor, appearance.fill, appearance.sourceVisualKey)}
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

  const refreshGraph = useCallback(async () => {
    setGraphLoading(true);
    setGraphError("");
    try {
      const [
        nextObjectTypes,
        nextRelationshipTypes,
        nextObjects,
        nextSources,
        nextSourceTypeSettings,
        nextRelationships,
        nextCodes,
        nextAnnotationSummaries,
        nextObjectAttributeDefinitions,
        nextRelationshipAttributeDefinitions,
        nextSourceAttributeDefinitions,
        nextSourceAttributeValues,
        nextSavedDrawings,
        nextCanvasState,
        nextMemos,
        nextReports,
      ] = await Promise.all([
        listPostgresObjectTypes(project.id),
        listPostgresRelationshipTypes(project.id),
        listPostgresObjects(project.id),
        listPostgresSources(project.id),
        listPostgresSourceTypeSettings(project.id),
        listPostgresRelationships(project.id),
        listPostgresCodes(project.id),
        listPostgresAnnotationSummaries(project.id),
        listPostgresObjectAttributeDefinitions(project.id),
        listPostgresRelationshipAttributeDefinitions(project.id),
        listPostgresSourceAttributeDefinitions(project.id),
        listPostgresSourceAttributeValues(project.id),
        listPostgresSavedDrawingSummaries(project.id),
        getPostgresProjectCanvasState(project.id),
        listPostgresMemos(project.id),
        listPostgresReports(project.id),
      ]);
      setObjectTypes(nextObjectTypes);
      setRelationshipTypes(nextRelationshipTypes);
      setObjects(nextObjects);
      setSources(nextSources);
      setSourceTypeSettings(nextSourceTypeSettings);
      setRelationships(nextRelationships);
      setCodes(nextCodes);
      setAnnotationSummaries(nextAnnotationSummaries);
      setObjectAttributeDefinitions(nextObjectAttributeDefinitions);
      setRelationshipAttributeDefinitions(nextRelationshipAttributeDefinitions);
      setSourceAttributeDefinitions(nextSourceAttributeDefinitions);
      setSourceAttributeValues(nextSourceAttributeValues);
      setSavedDrawings(nextSavedDrawings);
      setMemoCount(nextMemos.length);
      setReportCount(nextReports.length);
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
      setSourceTypeSettings([]);
      setRelationships([]);
      setCodes([]);
      setAnnotationSummaries([]);
      setObjectAttributeDefinitions([]);
      setRelationshipAttributeDefinitions([]);
      setSourceAttributeDefinitions([]);
      setSourceAttributeValues([]);
      setSavedDrawings([]);
      setMemoCount(0);
      setReportCount(0);
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
    if (editingRelationshipFromObjectId && availableEditingFromEndpointOptions.some((option) => option.key === editingRelationshipFromObjectId)) return;
    setEditingRelationshipFromObjectId(availableEditingFromEndpointOptions[0]?.key ?? "");
  }, [availableEditingFromEndpointOptions, editingRelationshipFromObjectId, editingRelationshipId]);

  useEffect(() => {
    if (editingRelationshipId === null) return;
    if (editingRelationshipToObjectId && availableEditingToEndpointOptions.some((option) => option.key === editingRelationshipToObjectId)) return;
    setEditingRelationshipToObjectId(availableEditingToEndpointOptions[0]?.key ?? "");
  }, [availableEditingToEndpointOptions, editingRelationshipId, editingRelationshipToObjectId]);

  useEffect(() => {
    if (activeScreen !== "home" && activeScreen !== "explore") return;
    setCanvasNodes((current) => {
      const canvasSourceObjects = activeScreen === "home" ? homeCanvasObjects : objects;
      const canvasSourceObjectTypes = activeScreen === "home" ? [...objectTypes, ...homeCanvasVirtualObjectTypes] : objectTypes;
      const objectTypeById = new Map(canvasSourceObjectTypes.map((objectType) => [objectType.id, objectType]));
      const next: Record<string, PostgresCanvasNodeState> = {};
      canvasSourceObjects.forEach((object, index) => {
        const existing = current[object.id];
        const objectTypeRecord = objectTypeById.get(object.objectTypeId) ?? null;
        const appearance = getPostgresObjectAppearance(object, objectTypeRecord);
        const defaultDimensions = appearance.sourceImage
          ? getSourceCanvasNodeDefaultDimensions()
          : getCanvasNodeDefaultDimensions(appearance.shape);
        const column = index % 4;
        const row = Math.floor(index / 4);
        if (existing) {
          next[object.id] = existing;
          return;
        }
        const fallbackPosition = { x: column * 260, y: row * 180 };
        const position = findAvailableCanvasNodePosition({
          existingNodes: Object.values(next),
          width: defaultDimensions.width,
          height: defaultDimensions.height,
          fallbackPosition,
        });
        next[object.id] = {
          id: object.id,
          x: position.x,
          y: position.y,
          width: defaultDimensions.width,
          height: defaultDimensions.height,
        };
      });
      return areCanvasNodeMapsEqual(current, next) ? current : next;
    });
  }, [activeScreen, homeCanvasObjects, homeCanvasVirtualObjectTypes, objectTypes, objects]);

  useEffect(() => {
    if (!canvasStateLoaded || (activeScreen !== "home" && activeScreen !== "explore")) return;
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

  async function handleSaveBulkObjectAttributeValues(
    definition: PostgresObjectAttributeDefinition,
    valuesByObjectId: Record<string, string>,
  ) {
    setGraphSubmitting(true);
    setGraphError("");
    setGraphNotice("");
    try {
      const definitionsForType = objectAttributeDefinitions.filter((entry) => entry.objectTypeId === definition.objectTypeId);
      const updatedObjects = await Promise.all(
        objects
          .filter((object) => object.objectTypeId === definition.objectTypeId)
          .map((object) => {
            const existingValues = valuesForObject(object);
            return savePostgresObject({
              projectId: project.id,
              objectId: object.id,
              objectTypeId: object.objectTypeId,
              title: object.title,
              description: object.description,
              shapeOverride: object.shapeOverride || null,
              colorOverride: object.colorOverride || null,
              outlineColorOverride: object.outlineColorOverride || null,
              fillOverride: object.fillOverride || null,
              imageStoragePath: object.imageStoragePath || null,
              eventStartAt: object.eventStartAt,
              eventEndAt: object.eventEndAt,
              eventTimePrecision: object.eventTimePrecision,
              eventTimezone: object.eventTimezone,
              eventIsInstant: object.eventIsInstant,
              attributeValues: definitionsForType.map((entry) => ({
                attributeDefinitionId: entry.id,
                value: entry.id === definition.id
                  ? valuesByObjectId[object.id] ?? ""
                  : existingValues[entry.id] ?? "",
              })),
            });
          }),
      );
      setObjects((current) => current.map((object) => (
        updatedObjects.find((updated) => updated.id === object.id) ?? object
      )));
      setBulkObjectAttributeDefinition(null);
      setGraphNotice(`Updated ${definition.name}.`);
    } catch (error) {
      setGraphError(error instanceof Error ? error.message : String(error));
    } finally {
      setGraphSubmitting(false);
    }
  }

  async function handleSaveBulkRelationshipAttributeValues(
    definition: PostgresRelationshipAttributeDefinition,
    valuesByRelationshipId: Record<string, string>,
  ) {
    setGraphSubmitting(true);
    setGraphError("");
    setGraphNotice("");
    try {
      const definitionsForType = relationshipAttributeDefinitions.filter((entry) => entry.relationshipTypeId === definition.relationshipTypeId);
      const updatedRelationships = await Promise.all(
        relationships
          .filter((relationship) => relationship.relationshipTypeId === definition.relationshipTypeId)
          .map((relationship) => {
            const existingValues = valuesForRelationship(relationship);
            return savePostgresRelationship({
              projectId: project.id,
              relationshipId: relationship.id,
              fromEntityType: relationship.fromEntityType,
              fromEntityId: relationship.fromEntityId,
              toEntityType: relationship.toEntityType,
              toEntityId: relationship.toEntityId,
              relationshipTypeId: relationship.relationshipTypeId,
              description: relationship.description,
              lineShapeOverride: relationship.lineShapeOverride || null,
              lineWeightOverride: relationship.lineWeightOverride,
              arrowheadOverride: relationship.arrowheadOverride || null,
              colorOverride: relationship.colorOverride || null,
              attributeValues: definitionsForType.map((entry) => ({
                attributeDefinitionId: entry.id,
                value: entry.id === definition.id
                  ? valuesByRelationshipId[relationship.id] ?? ""
                  : existingValues[entry.id] ?? "",
              })),
            });
          }),
      );
      setRelationships((current) => current.map((relationship) => (
        updatedRelationships.find((updated) => updated.id === relationship.id) ?? relationship
      )));
      setBulkRelationshipAttributeDefinition(null);
      setGraphNotice(`Updated ${definition.name}.`);
    } catch (error) {
      setGraphError(error instanceof Error ? error.message : String(error));
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
            timelineRole: draft.timelineRole ?? "",
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
            timelineRole: draft.timelineRole ?? "",
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
        outlineColorOverride: objectGraphicMode === "inherit" ? null : normalizeOptionalPostgresObjectTypeColor(objectOutlineColorOverride) || null,
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
      setObjectOutlineColorOverride("");
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
        setCanvasNodes((current) => {
          const width = current[created.id]?.width ?? defaultDimensions.width;
          const height = current[created.id]?.height ?? defaultDimensions.height;
          const position = findAvailableCanvasNodePosition({
            existingNodes: Object.values(current).filter((node) => node.id !== created.id),
            width,
            height,
            preferredPosition: pendingCanvasNodePosition,
          });
          return {
            ...current,
            [created.id]: {
            id: created.id,
            x: position.x,
            y: position.y,
            width,
            height,
          },
          };
        });
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
      const preservePendingObjectDraft = createObjectOpen;
      setDraftObjectTypeName("");
      setDraftObjectTypeDescription("");
      setDraftObjectTypeShape("rounded");
      setDraftObjectTypeColor(POSTGRES_OBJECT_TYPE_DEFAULT_COLOR);
      setDraftObjectTypeOutlineColor("");
      setDraftObjectTypeFill("filled");
      setDraftObjectTypeImageStoragePath("");
      setDraftObjectTypePendingImage(null);
      setDraftObjectTypeGraphicMode("select");
      initializeObjectTypeAttributeEditor(null);
      setObjectTypeModalTab("details");
      setCreateObjectTypeOpen(false);
      setSelectedObjectTypeFilter(existingTypeRecord?.id ?? "all");
      setObjectTypeId(existingTypeRecord?.id ?? "");
      if (!preservePendingObjectDraft) {
        setObjectTitle("");
        setObjectDescription("");
        setObjectAttributeValues({});
      }
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
        outlineColor: normalizeOptionalPostgresObjectTypeColor(draftObjectTypeOutlineColor) || null,
        fill: draftObjectTypeFill,
        imageStoragePath: draftObjectTypeImageStoragePath.trim() || null,
        attributes: objectTypeAttributeDrafts.map((draft) => ({
          id: draft.id || null,
          name: draft.name,
          dataType: draft.dataType,
          description: draft.description,
          options: draft.options,
          timelineRole: draft.timelineRole ?? "",
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
      setDraftObjectTypeOutlineColor("");
      setDraftObjectTypeFill("filled");
      setDraftObjectTypeImageStoragePath("");
      setDraftObjectTypePendingImage(null);
      setDraftObjectTypeGraphicMode("select");
      initializeObjectTypeAttributeEditor(null);
      setObjectTypeModalTab("details");
      setCreateObjectTypeOpen(false);
      setSelectedObjectTypeFilter(savedObjectType.id);
      setObjectTypeId(savedObjectType.id);
      if (!createObjectOpen) {
        setObjectTitle("");
        setObjectDescription("");
        setObjectAttributeValues({});
      }
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
      setOutlineColorOverride: Dispatch<SetStateAction<string>>;
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
      config.setOutlineColorOverride("");
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
        editingObjectShapeOverride || editingObjectColorOverride || editingObjectOutlineColorOverride || editingObjectFillOverride ? "select" : "inherit",
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
        outlineColor: normalizeOptionalPostgresObjectTypeColor(draftObjectTypeOutlineColor) || null,
        fill: draftObjectTypeFill,
        imageStoragePath: draftObjectTypeImageStoragePath.trim() || null,
        attributes: objectTypeAttributeDrafts.map((draft) => ({
          id: draft.id || null,
          name: draft.name,
          dataType: draft.dataType,
          description: draft.description,
          options: draft.options,
          timelineRole: draft.timelineRole ?? "",
        })),
      });
      applySavedObjectTypeState(saved.objectType, saved.attributeDefinitions);
      const savedDefinitionByDraftLocalId = new Map(
        objectTypeAttributeDrafts
          .map((draft) => {
            const savedDefinition = draft.id
              ? saved.attributeDefinitions.find((definition) => definition.id === draft.id)
              : saved.attributeDefinitions.find((definition) => definition.name.trim().toLowerCase() === draft.name.trim().toLowerCase());
            return savedDefinition ? [draft.localId, savedDefinition] as const : null;
          })
          .filter((entry): entry is readonly [string, PostgresObjectAttributeDefinition] => Boolean(entry)),
      );
      const updatedObjects = await Promise.all(
        objects
          .filter((object) => object.objectTypeId === saved.objectType.id)
          .map((object) => {
            const existingValues = valuesForObject(object);
            return savePostgresObject({
              projectId: project.id,
              objectId: object.id,
              objectTypeId: object.objectTypeId,
              title: object.title,
              description: object.description,
              shapeOverride: object.shapeOverride || null,
              colorOverride: object.colorOverride || null,
              outlineColorOverride: object.outlineColorOverride || null,
              fillOverride: object.fillOverride || null,
              imageStoragePath: object.imageStoragePath || null,
              eventStartAt: object.eventStartAt,
              eventEndAt: object.eventEndAt,
              eventTimePrecision: object.eventTimePrecision,
              eventTimezone: object.eventTimezone,
              eventIsInstant: object.eventIsInstant,
              attributeValues: saved.attributeDefinitions.map((definition) => {
                const draftEntry = Array.from(savedDefinitionByDraftLocalId.entries())
                  .find(([, savedDefinition]) => savedDefinition.id === definition.id);
                const draftLocalId = draftEntry?.[0] ?? definition.id;
                return {
                  attributeDefinitionId: definition.id,
                  value: objectTypeAttributeValuesByDraftId[draftLocalId]?.[object.id] ?? existingValues[definition.id] ?? "",
                };
              }),
            });
          }),
      );
      if (updatedObjects.length > 0) {
        setObjects((current) => current.map((object) => (
          updatedObjects.find((updated) => updated.id === object.id) ?? object
        )));
      }
      setEditingObjectTypeModalId(null);
      setDraftObjectTypeName("");
      setDraftObjectTypeDescription("");
      setDraftObjectTypeShape("rounded");
      setDraftObjectTypeColor(POSTGRES_OBJECT_TYPE_DEFAULT_COLOR);
      setDraftObjectTypeOutlineColor("");
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
        outlineColorOverride: editingObjectGraphicMode === "inherit" ? null : normalizeOptionalPostgresObjectTypeColor(editingObjectOutlineColorOverride) || null,
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
          timelineRole: definition.timelineRole,
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
          timelineRole: definition.timelineRole,
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
          timelineRole: draft.timelineRole ?? "",
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
          timelineRole: draft.timelineRole ?? "",
        })),
      });
      applySavedRelationshipTypeState(saved.relationshipType, saved.attributeDefinitions);
      const savedDefinitionByDraftLocalId = new Map(
        relationshipTypeAttributeDrafts
          .map((draft) => {
            const savedDefinition = draft.id
              ? saved.attributeDefinitions.find((definition) => definition.id === draft.id)
              : saved.attributeDefinitions.find((definition) => definition.name.trim().toLowerCase() === draft.name.trim().toLowerCase());
            return savedDefinition ? [draft.localId, savedDefinition] as const : null;
          })
          .filter((entry): entry is readonly [string, PostgresRelationshipAttributeDefinition] => Boolean(entry)),
      );
      const updatedRelationships = await Promise.all(
        relationships
          .filter((relationship) => relationship.relationshipTypeId === saved.relationshipType.id)
          .map((relationship) => {
            const existingValues = valuesForRelationship(relationship);
            return savePostgresRelationship({
              projectId: project.id,
              relationshipId: relationship.id,
              fromEntityType: relationship.fromEntityType,
              fromEntityId: relationship.fromEntityId,
              toEntityType: relationship.toEntityType,
              toEntityId: relationship.toEntityId,
              relationshipTypeId: relationship.relationshipTypeId,
              description: relationship.description,
              lineShapeOverride: relationship.lineShapeOverride || null,
              lineWeightOverride: relationship.lineWeightOverride,
              arrowheadOverride: relationship.arrowheadOverride || null,
              colorOverride: relationship.colorOverride || null,
              attributeValues: saved.attributeDefinitions.map((definition) => {
                const draftEntry = Array.from(savedDefinitionByDraftLocalId.entries())
                  .find(([, savedDefinition]) => savedDefinition.id === definition.id);
                const draftLocalId = draftEntry?.[0] ?? definition.id;
                return {
                  attributeDefinitionId: definition.id,
                  value: relationshipTypeAttributeValuesByDraftId[draftLocalId]?.[relationship.id] ?? existingValues[definition.id] ?? "",
                };
              }),
            });
          }),
      );
      if (updatedRelationships.length > 0) {
        setRelationships((current) => current.map((relationship) => (
          updatedRelationships.find((updated) => updated.id === relationship.id) ?? relationship
        )));
      }
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
    const fromEndpoint = parsePostgresRelationshipEndpointKey(editingRelationshipFromObjectId);
    const toEndpoint = parsePostgresRelationshipEndpointKey(editingRelationshipToObjectId);
    if (
      !editingRelationshipId
      || !fromEndpoint
      || !toEndpoint
      || !editingRelationshipTypeId
    ) {
      setGraphError("Choose two endpoints and a relationship type.");
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
        fromEntityType: fromEndpoint.entityType,
        fromEntityId: fromEndpoint.entityId,
        toEntityType: toEndpoint.entityType,
        toEntityId: toEndpoint.entityId,
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
        projectRoleLabel={
          isProjectAdmin
            ? "Administrator"
            : currentProjectUser
              ? projectRoleLabel(currentProjectUser.role)
              : "Member"
        }
        networkMode={sidebarNetworkMode}
        aiStatus={aiAssistAllowed ? sidebarAiStatus : "disabled"}
        aiAssistAllowed={aiAssistAllowed}
        collaborationStatus={sidebarCollaborationStatus}
        onShowProjects={onBack}
        onShowProjectHome={() => setActiveScreen("home")}
        onShowProjectUsers={() => setActiveScreen("users")}
        onShowProjectSources={() => setActiveScreen("sources")}
        onShowProjectAnnotations={() => setActiveScreen("annotations")}
        onShowProjectCodebook={() => setActiveScreen("codebook")}
        onShowProjectCodeText={() => setActiveScreen("code-text")}
        onShowProjectMemos={() => setActiveScreen("memos")}
        onShowProjectReports={() => setActiveScreen("reports")}
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
        onBackToGate={onBack}
        onSignOut={onSignOut}
      />
      <main className="app-main">
        <div className="view">
          {activeScreen === "home" ? (
            <div className="view users-view postgres-experiment-home-view" style={{ minHeight: "100%" }}>
              <header className="view-header">
                <div className="users-title-wrap">
                  <h1>{project.name || "Untitled project"}</h1>
                </div>
              </header>
              <div className="ai-assist-home-tabbar" style={{ marginBottom: 18 }}>
                <div className="segmented-control" role="tablist" aria-label="Project home views">
                  {([
                    ["details", "Details"],
                    ["graph", "Graph"],
                    ["timeline", "Timeline"],
                  ] as const).map(([tabValue, tabLabel]) => (
                    <button
                      key={tabValue}
                      type="button"
                      className={`segmented-control-option ${projectHomeTab === tabValue ? "segmented-control-option--active" : ""}`}
                      role="tab"
                      aria-selected={projectHomeTab === tabValue}
                      onClick={() => setProjectHomeTab(tabValue)}
                    >
                      {tabLabel}
                    </button>
                  ))}
                </div>
              </div>
              {projectHomeTab === "details" ? (
                <PostgresProjectHomeDetailsView
                  project={project}
                  users={users}
                  currentProjectUser={currentProjectUser}
                  isProjectAdmin={isProjectAdmin}
                  lastProjectActivityAt={lastProjectActivityAt}
                  sourceCount={sources.length}
                  sourceStats={homeCanvasSourceKindSummaries.map((summary) => ({
                    label: summary.label,
                    value: summary.count,
                  }))}
                  objectCount={objects.length}
                  objectTypeCount={objectTypeSummaries.length}
                  relationshipCount={relationships.length}
                  relationshipTypeCount={new Set(relationships.map((relationship) => relationship.relationshipType.trim()).filter(Boolean)).size}
                  codeCount={codes.length}
                  annotationCount={annotationSummaries.length}
                  memoCount={memoCount}
                  reportCount={reportCount}
                  statsRef={projectHomeDetailsStatsRef}
                  statsHeight={projectHomeDetailsStatsHeight}
                  formatDateTime={formatPostgresDateTime}
                  onShowUsers={() => setActiveScreen("users")}
                  onShowSources={() => setActiveScreen("sources")}
                  onShowObjects={() => setActiveScreen("objects")}
                  onShowRelationships={() => setActiveScreen("relationships")}
                  onShowCodebook={() => setActiveScreen("codebook")}
                  onShowAnnotations={() => setActiveScreen("annotations")}
                  onShowMemos={() => setActiveScreen("memos")}
                  onShowReports={() => setActiveScreen("reports")}
                />
              ) : projectHomeTab === "timeline" ? (
                <PostgresProjectHomeTimelineView
                  sources={sources}
                  sourceTypeSettings={sourceTypeSettings}
                  sourceAttributeDefinitions={sourceAttributeDefinitions}
                  sourceAttributeValues={sourceAttributeValues}
                  objects={objects}
                  objectTypes={objectTypes}
                  objectAttributeDefinitions={objectAttributeDefinitions}
                  relationships={relationships}
                  relationshipTypes={relationshipTypes}
                  relationshipAttributeDefinitions={relationshipAttributeDefinitions}
                  canManageSources={canManageSources}
                  canManageAnnotations={canManageAnnotations}
                  onCreateSource={openCreateSourceModal}
                  onCreateObject={openCreateObjectModal}
                  onCreateRelationship={() => openCreateRelationshipModal()}
                  onCreateCode={openCreateCodeModal}
                  onTimelineItemContextMenu={handleHomeTimelineItemContextMenu}
                />
              ) : (
                <PostgresProjectHomeGraphView
                  createControlRef={homeCanvasCreateControlRef}
                  filterControlRef={homeCanvasFilterControlRef}
                  sizeControlRef={homeCanvasSizeControlRef}
                  createMenuOpen={homeCanvasCreateMenuOpen}
                  setCreateMenuOpen={setHomeCanvasCreateMenuOpen}
                  filterDrawerOpen={homeCanvasFilterDrawerOpen}
                  setFilterDrawerOpen={setHomeCanvasFilterDrawerOpen}
                  sizeMenuOpen={homeCanvasSizeMenuOpen}
                  setSizeMenuOpen={setHomeCanvasSizeMenuOpen}
                  graphLoading={graphLoading}
                  canvasStateLoaded={canvasStateLoaded}
                  loadingFallback={<ViewLoadingFallback />}
                  canManageSources={canManageSources}
                  canManageAnnotations={canManageAnnotations}
                  onCreateSource={openCreateSourceModal}
                  onCreateObject={openCreateObjectModal}
                  onCreateRelationship={() => openCreateRelationshipModal()}
                  onCreateCode={openCreateCodeModal}
                  objectTypes={objectTypes}
                  homeCanvasVirtualObjectTypes={homeCanvasVirtualObjectTypes}
                  homeCanvasObjects={homeCanvasObjects}
                  homeCanvasRelationships={homeCanvasRelationships}
                  homeCanvasRelationshipTypes={homeCanvasRelationshipTypes}
                  canvasNodes={canvasNodes}
                  setCanvasNodes={setCanvasNodes}
                  hiddenCanvasRelationshipIds={hiddenCanvasRelationshipIds}
                  getObjectAppearance={getPostgresObjectAppearance}
                  getObjectSurfaceStyle={getPostgresObjectSurfaceStyle}
                  getRelationshipAppearance={getPostgresRelationshipAppearance}
                  getRelationshipStrokeWidth={getPostgresRelationshipStrokeWidth}
                  getNodeDefaultDimensions={(object, objectTypeRecord) => {
                    const appearance = getPostgresObjectAppearance(object, objectTypeRecord);
                    return appearance.sourceImage
                      ? getSourceCanvasNodeDefaultDimensions()
                      : getCanvasNodeDefaultDimensions(appearance.shape);
                  }}
                  getNodeRenderedDimensions={(object, objectTypeRecord, nodeState) => {
                    const appearance = getPostgresObjectAppearance(object, objectTypeRecord);
                    return appearance.sourceImage
                      ? getSourceCanvasNodeRenderedDimensions(nodeState)
                      : getCanvasNodeRenderedDimensions(appearance.shape, nodeState);
                  }}
                  getInspectorDetails={(selection) => {
                    if (selection.kind === "relationship") {
                      return {
                        title: selection.relationship.relationshipType.trim() || "Relationship",
                        itemType: "Relationship",
                        typeDetail: selection.relationship.relationshipType.trim() || selection.relationshipTypeRecord?.name || "",
                        attributes: selection.relationship.attributeValues
                          .filter((value) => value.value.trim())
                          .sort((left, right) => left.sortOrder - right.sortOrder || left.attributeName.localeCompare(right.attributeName, undefined, { sensitivity: "base" }))
                          .map((value) => ({ name: value.attributeName, value: value.value })),
                      };
                    }

                    const systemKey = selection.object.objectTypeSystemKey ?? selection.objectTypeRecord?.systemKey ?? "";
                    const sourceVisualKey = getPostgresSourceObjectVisualKey(systemKey);
                    if (sourceVisualKey || systemKey === "home_canvas_source") {
                      return {
                        title: selection.object.title.trim() || "Untitled source",
                        itemType: "Source",
                        typeDetail: selection.object.objectType.trim() || selection.objectTypeRecord?.name || "",
                        attributes: sourceAttributeValues
                          .filter((value) => value.sourceId === selection.object.id && value.value.trim())
                          .sort((left, right) => left.sortOrder - right.sortOrder || left.attributeName.localeCompare(right.attributeName, undefined, { sensitivity: "base" }))
                          .map((value) => ({ name: value.attributeName, value: value.value })),
                      };
                    }

                    if (systemKey === "home_canvas_code") {
                      const parentLabels: string[] = [];
                      let parentCodeId = codes.find((code) => code.id === selection.object.id)?.parentCodeId ?? "";
                      const visitedParentCodeIds = new Set<string>();
                      while (parentCodeId && !visitedParentCodeIds.has(parentCodeId)) {
                        visitedParentCodeIds.add(parentCodeId);
                        const parentCode = codes.find((code) => code.id === parentCodeId);
                        if (!parentCode) break;
                        parentLabels.unshift(parentCode.label || "Untitled code");
                        parentCodeId = parentCode.parentCodeId;
                      }
                      return {
                        title: selection.object.title.trim() || "Untitled code",
                        itemType: "Code",
                        typeDetail: parentLabels.length > 0 ? parentLabels.join(" > ") : "Top-level code",
                        attributes: [],
                      };
                    }

                    return {
                      title: selection.object.title.trim() || "Untitled object",
                      itemType: "Object",
                      typeDetail: selection.object.objectType.trim() || selection.objectTypeRecord?.name || "",
                      attributes: selection.object.attributeValues
                        .filter((value) => value.value.trim())
                        .sort((left, right) => left.sortOrder - right.sortOrder || left.attributeName.localeCompare(right.attributeName, undefined, { sensitivity: "base" }))
                        .map((value) => ({ name: value.attributeName, value: value.value })),
                    };
                  }}
                  onCanvasContextMenu={handleHomeCanvasContextMenu}
                  onCanvasSelectionDelete={canDeleteHomeCanvasItems ? startHomeCanvasSelectionDelete : undefined}
                  getRelationshipEndpointKey={({ object, objectTypeRecord }) => {
                    if (!canManageSources) return null;
                    const systemKey = object.objectTypeSystemKey ?? objectTypeRecord?.systemKey ?? "";
                    if (systemKey === "home_canvas_code" || systemKey === "home_canvas_annotation") return null;
                    if (systemKey === "home_canvas_source" || getPostgresSourceObjectVisualKey(systemKey)) {
                      return `source:${object.id}`;
                    }
                    return `object:${object.id}`;
                  }}
                  onCanvasRelationshipDraftComplete={({ fromEndpointKey, toEndpointKey }) => {
                    openCreateRelationshipModal({ fromEndpointKey, toEndpointKey });
                  }}
                  fitOnVisibleKey={projectHomeGraphFitKey}
                  filteringActive={homeCanvasFilteringActive}
                  collapsedSections={homeCanvasCollapsedSections}
                  sourceRows={homeCanvasSourceRows}
                  objectRows={homeCanvasObjectRows}
                  relationshipRows={homeCanvasRelationshipRows}
                  codeRows={homeCanvasCodeRows}
                  sourceCount={sources.length}
                  objectCount={objects.length}
                  relationshipCount={relationships.length}
                  codeCount={codes.length}
                  onToggleCollapsedSection={toggleHomeCanvasSectionCollapsed}
                  showSection={showHomeCanvasSection}
                  clearSection={clearHomeCanvasSection}
                  setSourceKinds={setHomeCanvasSourceKinds}
                  setObjectTypeIds={setHomeCanvasObjectTypeIds}
                  setRelationshipTypeIds={setHomeCanvasRelationshipTypeIds}
                  setCodeIds={setHomeCanvasCodeIds}
                  customSizesActive={homeCanvasCustomSizesActive}
                  resetAllNodeSizes={resetAllHomeCanvasNodeSizes}
                  sizeGroupCount={homeCanvasSizeGroupCount}
                  sizeCollapsedSections={homeCanvasSizeCollapsedSections}
                  sourceSizeRows={homeCanvasSourceSizeRows}
                  objectSizeRows={homeCanvasObjectSizeRows}
                  codeSizeRows={homeCanvasCodeSizeRows}
                  onToggleSizeSectionCollapsed={toggleHomeCanvasSizeSectionCollapsed}
                  onResizeNodeGroup={resizeHomeCanvasNodeGroup}
                />
              )}
            </div>
          ) : activeScreen === "users" ? (
            <>
              <div className="view users-view postgres-users-view">
                <header className="view-header">
                  <div className="users-title-wrap">
                    <h1>Project Users</h1>
                  </div>
                </header>

                <div className="users-content postgres-users-content" style={{ alignItems: "stretch" }}>
                  {usersError ? <p className="users-error">{usersError}</p> : null}

                  <div
                    className="postgres-sources-grid project-users-grid"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(280px, 340px) auto minmax(0, 1fr)",
                      gap: 0,
                      alignItems: "stretch",
                      flex: "0 0 auto",
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
                          </div>
                        </div>
                        <div>
                          <table className="users-table" style={{ tableLayout: "fixed" }}>
                            <thead>
                              <tr>
                                <th
                                  className={`users-th${userRoleSortCol === "role" ? " users-th--sorted" : ""}`}
                                  style={{ width: "76%" }}
                                  onClick={() => handleUserRoleSort("role")}
                                >
                                  Role
                                  <span className="users-sort-icon">
                                    {userRoleSortCol === "role" ? (userRoleSortDir === "asc" ? " ?" : " ?") : " ?"}
                                  </span>
                                </th>
                                <th
                                  className={`users-th${userRoleSortCol === "count" ? " users-th--sorted" : ""}`}
                                  style={{ width: "24%" }}
                                  onClick={() => handleUserRoleSort("count")}
                                >
                                  Count
                                  <span className="users-sort-icon">
                                    {userRoleSortCol === "count" ? (userRoleSortDir === "asc" ? " ?" : " ?") : " ?"}
                                  </span>
                                </th>
                              </tr>
                            </thead>
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
                                  All users
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

                    <div className="project-users-col-divider" aria-hidden="true" />

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
                                <th className="users-th" style={{ width: "28%" }}>User</th>
                                <th className="users-th" style={{ width: "18%" }}>Role</th>
                                <th className="users-th" style={{ width: "27%" }}>Created</th>
                                <th className="users-th" style={{ width: "27%" }}>Last active</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredProjectUsers.map((user) => (
                                <tr
                                  key={user.id}
                                  className="users-row project-users-row"
                                >
                                  <td className="users-td users-td--name">
                                    <div className="postgres-users-name-cell">
                                      <span>{user.name}</span>
                                    </div>
                                  </td>
                                  <td className="users-td">
                                    <span className={`role-badge role-badge--${user.role}`}>
                                      {projectRoleLabel(user.role)}
                                    </span>
                                  </td>
                                  <td className="users-td users-td--muted">{formatCurrentDateTime(user.createdAt)}</td>
                                  <td className="users-td users-td--muted">
                                    {user.lastActiveAt ? formatCurrentDateTime(user.lastActiveAt) : "Never"}
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
              </div>

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
                            outlineColor={resolvePostgresObjectOutlineColor(selectedObjectDetails, selectedObjectDetailsType)}
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
                          <dt>Outline</dt>
                          <dd>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                              <span
                                aria-hidden="true"
                                style={{
                                  width: 18,
                                  height: 18,
                                  borderRadius: 6,
                                  border: "1px solid rgba(53, 80, 112, 0.18)",
                                  background: resolvePostgresObjectOutlineColor(selectedObjectDetails, selectedObjectDetailsType),
                                }}
                              />
                              {selectedObjectDetails.outlineColorOverride?.trim() || "Inherited"}
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
                      <GraphConfirmModal
                        title="Delete object"
                        warning="This permanently removes the object and any relationships connected to it."
                        busy={graphSubmitting}
                        confirmLabel="Delete object"
                        busyLabel="Deleting..."
                        onClose={() => setRemovingObjectId(null)}
                        onConfirm={() => void handleDeleteObject(object.id)}
                      >
                        <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                          Delete <strong>{object.title}</strong>?
                        </p>
                      </GraphConfirmModal>
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
                    <h1>Objects</h1>
                  </div>
                </header>

                <div
                  className="postgres-sources-grid"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(280px, 340px) auto minmax(0, 1fr)",
                    gap: 0,
                    alignItems: "stretch",
                    flex: "0 0 auto",
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
                          {!showObjectAttributesTable ? (
                            <button
                              type="button"
                              className="btn project-create-icon-button"
                              aria-label="Add object type"
                              title="Add object type"
                              onClick={openCreateObjectTypeModal}
                            >
                              <PlusIcon className="project-create-icon" />
                            </button>
                          ) : null}
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
                                  {objectTypeSortCol === "objectType" ? (objectTypeSortDir === "asc" ? " ?" : " ?") : " ?"}
                                </span>
                              </th>
                              <th
                                className={`users-th${objectTypeSortCol === "count" ? " users-th--sorted" : ""}`}
                                style={{ width: "24%" }}
                                onClick={() => handleObjectTypeSort("count")}
                              >
                                Count
                                <span className="users-sort-icon">
                                  {objectTypeSortCol === "count" ? (objectTypeSortDir === "asc" ? " ?" : " ?") : " ?"}
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
                                <span>All objects</span>
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
                                      outlineColor={normalizeOptionalPostgresObjectTypeColor(summary.outlineColor) || normalizePostgresObjectTypeColor(summary.color)}
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

                  <div className="project-workspace-col-divider" aria-hidden="true" />

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
                    <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 44 }}>
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
                          <div className="home-project-card project-table-card">
                            <div className="project-table-card-header">
                              <h2>Attributes</h2>
                              <button
                                type="button"
                                className="btn btn--primary project-table-header-icon-button"
                                onClick={openObjectWorkspaceAttributeModal}
                                disabled={graphSubmitting || objectWorkspaceAttributeTypeOptions.length === 0}
                                title="Add attribute"
                                aria-label="Add attribute"
                              >
                                <PlusIcon className="project-table-header-icon" />
                              </button>
                            </div>
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
                                      {objectAttributeSortCol === "name" ? (objectAttributeSortDir === "asc" ? " ?" : " ?") : " ?"}
                                    </span>
                                  </th>
                                  {objectAttributeDefinitionsForWorkspace.map((definition) => (
                                    <th
                                      key={definition.id}
                                      className={`users-th case-attributes-value-col case-attributes-value-col--editable${objectAttributeSortCol === definition.id ? " users-th--sorted" : ""}${hoveredObjectAttributeColumnId === definition.id ? " case-attributes-col--hovered" : ""}`}
                                      onMouseEnter={() => setHoveredObjectAttributeColumnId(definition.id)}
                                      onMouseLeave={() => setHoveredObjectAttributeColumnId(null)}
                                      onClick={() => {
                                        if (!canManageSources) return;
                                        setBulkObjectAttributeDefinition(definition);
                                        setGraphError("");
                                        setGraphNotice("");
                                      }}
                                      title={canManageSources ? "Edit values for this attribute" : "Only project owners, administrators, or editors can edit object attributes."}
                                    >
                                      {definition.name}
                                      <span className="users-sort-icon">
                                        {objectAttributeSortCol === definition.id ? (objectAttributeSortDir === "asc" ? " ?" : " ?") : " ?"}
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
                                            className={`users-td case-attributes-value-cell${cellActive ? " case-attributes-cell--active" : ""}${hoveredObjectAttributeColumnId === definition.id ? " case-attributes-col--hovered" : ""}`}
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
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="home-project-card project-table-card">
                        <div className="project-table-card-header">
                          <h2>Objects</h2>
                          <button
                            type="button"
                            className="btn btn--primary project-table-header-icon-button"
                            aria-label="New object"
                            title="New object"
                            onClick={() => openCreateObjectModal()}
                          >
                            <PlusIcon className="project-table-header-icon" />
                          </button>
                        </div>
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
                            {filteredObjects.length === 0 ? (
                              <tr>
                                <td colSpan={3} className="users-td-msg">
                                  {selectedObjectTypeFilter === "all"
                                    ? "No objects yet."
                                    : `No ${objectTypeById.get(selectedObjectTypeFilter)?.name ?? "selected"} objects yet.`}
                                </td>
                              </tr>
                            ) : (
                              filteredObjects.map((object) => {
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
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
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
                      <GraphConfirmModal
                        title="Delete object type"
                        warning={`This will delete the object type and all ${affectedObjectCount} objects of this type. This cannot be undone.`}
                        busy={graphSubmitting}
                        confirmLabel="Delete object type"
                        busyLabel="Deleting..."
                        onClose={() => setRemovingObjectTypeId(null)}
                        onConfirm={() => void handleDeleteObjectType(objectTypeRecord.id)}
                      >
                          <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                            Delete <strong>{objectTypeRecord.name}</strong>?
                          </p>
                          <p className="users-guide-copy" style={{ marginTop: 10, marginBottom: 0 }}>
                            Confirm that you want to permanently delete this object type and its objects.
                          </p>
                      </GraphConfirmModal>
                    );
                  })()
                ) : null}
                {editingObjectTypeModalId ? (
                  <SettingsModal
                    title="Edit object type"
                    onClose={() => setEditingObjectTypeModalId(null)}
                    closeDisabled={graphSubmitting}
                    modalClassName="modal--wide"
                  >
                      <form onSubmit={handleSaveObjectType} className="form app-settings-modal-body">
                        <div className="segmented-control modal-segmented-control" role="tablist" aria-label="Edit object type tabs">
                          <button
                            type="button"
                            className={`segmented-control-option ${objectTypeModalTab === "details" ? "segmented-control-option--active" : ""}`}
                            onClick={() => setObjectTypeModalTab("details")}
                          >
                            Details
                          </button>
                          <button
                            type="button"
                            className={`segmented-control-option ${objectTypeModalTab === "graphics" ? "segmented-control-option--active" : ""}`}
                            onClick={() => setObjectTypeModalTab("graphics")}
                          >
                            Graphics
                          </button>
                          <button
                            type="button"
                            className={`segmented-control-option ${objectTypeModalTab === "attributes" ? "segmented-control-option--active" : ""}`}
                            onClick={() => setObjectTypeModalTab("attributes")}
                          >
                            Attributes
                          </button>
                          <button
                            type="button"
                            className={`segmented-control-option ${objectTypeModalTab === "timeline" ? "segmented-control-option--active" : ""}`}
                            onClick={() => setObjectTypeModalTab("timeline")}
                          >
                            Timeline
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
                                    outlineColor={normalizeOptionalPostgresObjectTypeColor(draftObjectTypeOutlineColor) || normalizePostgresObjectTypeColor(draftObjectTypeColor)}
                                    width={56}
                                    minHeight={44}
                                  />
                                )}
                            />
                          </label>
                          {draftObjectTypeGraphicMode === "upload" ? (
                            <label className="form-label">
                              Outline
                              <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
                                <input
                                  className="form-input form-input--color"
                                  type="color"
                                  value={normalizeOptionalPostgresObjectTypeColor(draftObjectTypeOutlineColor) || normalizePostgresObjectTypeColor(draftObjectTypeColor)}
                                  onChange={(event) => setDraftObjectTypeOutlineColor(event.target.value)}
                                  style={{ width: 92, minWidth: 92, height: 56 }}
                                />
                                <input
                                  className="form-input"
                                  value={draftObjectTypeOutlineColor || normalizePostgresObjectTypeColor(draftObjectTypeColor)}
                                  onChange={(event) => setDraftObjectTypeOutlineColor(event.target.value)}
                                  style={{ flex: "0 0 132px", fontFamily: "monospace" }}
                                />
                              </div>
                            </label>
                          ) : null}
                          {draftObjectTypeGraphicMode === "select" ? (
                              <>
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                                gap: 14,
                              }}
                            >
                              <label className="form-label">
                                Fill
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
                                    style={{ flex: "1 1 132px", minWidth: 0, fontFamily: "monospace" }}
                                  />
                                </div>
                              </label>
                              <label className="form-label">
                                Outline
                                <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
                                  <input
                                    className="form-input form-input--color"
                                    type="color"
                                    value={normalizeOptionalPostgresObjectTypeColor(draftObjectTypeOutlineColor) || normalizePostgresObjectTypeColor(draftObjectTypeColor)}
                                    onChange={(event) => setDraftObjectTypeOutlineColor(event.target.value)}
                                    style={{ width: 92, minWidth: 92, height: 56 }}
                                  />
                                  <input
                                    className="form-input"
                                    value={draftObjectTypeOutlineColor || normalizePostgresObjectTypeColor(draftObjectTypeColor)}
                                    onChange={(event) => setDraftObjectTypeOutlineColor(event.target.value)}
                                    style={{ flex: "1 1 132px", minWidth: 0, fontFamily: "monospace" }}
                                  />
                                </div>
                              </label>
                            </div>
                            <label className="form-label">
                              Fill Style
                              <PostgresObjectFillPicker
                                value={draftObjectTypeFill}
                                onChange={(value) => setDraftObjectTypeFill((value || "filled") as PostgresObjectFill)}
                                previewColor={draftObjectTypeColor}
                                previewOutlineColor={normalizeOptionalPostgresObjectTypeColor(draftObjectTypeOutlineColor) || normalizePostgresObjectTypeColor(draftObjectTypeColor)}
                                previewShape={draftObjectTypeShape}
                              />
                            </label>
                            <label className="form-label">
                              Shape
                              <PostgresObjectShapePicker
                                value={draftObjectTypeShape}
                                onChange={(value) => setDraftObjectTypeShape((value || "rounded") as PostgresObjectTypeShape)}
                                previewColor={draftObjectTypeColor}
                                previewOutlineColor={normalizeOptionalPostgresObjectTypeColor(draftObjectTypeOutlineColor) || normalizePostgresObjectTypeColor(draftObjectTypeColor)}
                                previewFill={draftObjectTypeFill}
                              />
                            </label>
                              </>
                            ) : null}
                          </>
                        ) : objectTypeModalTab === "timeline" ? (
                          renderTimelineFieldMappingRows(
                            objectTypeAttributeDrafts,
                            (role, value) => updateTimelineFieldDrafts(
                              role,
                              value,
                              setObjectTypeAttributeDrafts,
                              (draft) => {
                                setTypeAttributeModalError("");
                                setObjectTypeAttributeModalDraft(draft);
                              },
                            ),
                          )
                        ) : (
                          <EditableAttributesMatrix
                            definitions={objectTypeAttributeDrafts.map((draft) => ({
                              id: draft.localId,
                              name: draft.name || "Untitled attribute",
                              dataType: draft.dataType,
                              description: draft.description,
                              options: draft.options,
                            }))}
                            rows={objects
                              .filter((object) => object.objectTypeId === editingObjectTypeModalId)
                              .map((object) => ({ id: object.id, name: object.title || "Untitled object" }))
                              .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }))}
                            values={objectTypeAttributeValuesByDraftId}
                            disabled={graphSubmitting}
                            emptyDefinitionsLabel="No attributes for this object type yet."
                            emptyRowsLabel="No objects of this type yet."
                            onAddAttribute={openNewObjectTypeAttributeModal}
                            onEditAttribute={(localId) => {
                              const draft = objectTypeAttributeDrafts.find((entry) => entry.localId === localId);
                              if (draft) openEditObjectTypeAttributeModal(draft);
                            }}
                            onDeleteAttribute={deleteObjectTypeAttributeDraft}
                            onChangeValue={updateObjectTypeMatrixValue}
                          />
                        )}
                        <div className="app-settings-modal-footer">
                          <button type="button" className="btn" onClick={() => setEditingObjectTypeModalId(null)} disabled={graphSubmitting}>
                            Cancel
                          </button>
                          <button type="submit" className="btn btn--primary" disabled={graphSubmitting}>
                            {graphSubmitting ? "Saving..." : "Save changes"}
                          </button>
                        </div>
                      </form>
                  </SettingsModal>
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
                {bulkObjectAttributeDefinition ? (
                  <AttributeValuesModal
                    draft={bulkObjectAttributeDefinition}
                    rows={sortedObjectAttributeRows.map((row) => ({ id: row.id, name: row.name }))}
                    initialValuesByOwner={Object.fromEntries(
                      sortedObjectAttributeRows.map((row) => [
                        row.id,
                        row.valuesByDefinitionId[bulkObjectAttributeDefinition.id] ?? "",
                      ]),
                    )}
                    saving={graphSubmitting}
                    error={graphError}
                    onCancel={() => {
                      if (graphSubmitting) return;
                      setBulkObjectAttributeDefinition(null);
                      setGraphError("");
                    }}
                    onSave={(_, valuesByOwner) => {
                      void handleSaveBulkObjectAttributeValues(bulkObjectAttributeDefinition, valuesByOwner);
                    }}
                    emptyStateLabel="Create an object first to start assigning attribute values."
                  />
                ) : null}
                {removingObjectId ? (
                  (() => {
                    const object = objects.find((entry) => entry.id === removingObjectId);
                    if (!object) return null;
                    return (
                      <GraphConfirmModal
                        title="Delete object"
                        warning="This permanently removes the object and any relationships connected to it."
                        busy={graphSubmitting}
                        confirmLabel="Delete object"
                        busyLabel="Deleting..."
                        onClose={() => setRemovingObjectId(null)}
                        onConfirm={() => void handleDeleteObject(object.id)}
                      >
                        <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                          Delete <strong>{object.title}</strong>?
                        </p>
                      </GraphConfirmModal>
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
                </header>

                <div
                  className="postgres-sources-grid"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(280px, 340px) auto minmax(0, 1fr)",
                    gap: 0,
                    alignItems: "stretch",
                    flex: "0 0 auto",
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
                          {!showRelationshipAttributesTable ? (
                            <button
                              type="button"
                              className="btn project-create-icon-button"
                              aria-label="Add relationship type"
                              title="Add relationship type"
                              onClick={openCreateRelationshipTypeModal}
                            >
                              <PlusIcon className="project-create-icon" />
                            </button>
                          ) : null}
                        </div>
                      </div>

                      <div>
                        <table className="users-table" style={{ tableLayout: "fixed" }}>
                          <thead>
                            <tr>
                              <th
                                className={`users-th${relationshipTypeSortCol === "relationshipType" ? " users-th--sorted" : ""}`}
                                style={{ width: "76%" }}
                                onClick={() => handleRelationshipTypeSort("relationshipType")}
                              >
                                Type
                                <span className="users-sort-icon">
                                  {relationshipTypeSortCol === "relationshipType" ? (relationshipTypeSortDir === "asc" ? " ?" : " ?") : " ?"}
                                </span>
                              </th>
                              <th
                                className={`users-th${relationshipTypeSortCol === "count" ? " users-th--sorted" : ""}`}
                                style={{ width: "24%" }}
                                onClick={() => handleRelationshipTypeSort("count")}
                              >
                                Count
                                <span className="users-sort-icon">
                                  {relationshipTypeSortCol === "count" ? (relationshipTypeSortDir === "asc" ? " ?" : " ?") : " ?"}
                                </span>
                              </th>
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
                                <span>All relationships</span>
                              </td>
                              <td className="users-td users-td--muted">{relationships.length}</td>
                            </tr>
                            {relationshipTypeSummaries.map((summary) => (
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
                                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, paddingLeft: 18 }}>
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
                        {relationshipTypeSummaries.length === 0 ? (
                          <div className="empty-state" style={{ minHeight: 140 }}>
                            <p>No relationship types yet.</p>
                          </div>
                        ) : null}
                      </div>
                    </section>
                  </div>

                  <div className="project-workspace-col-divider" aria-hidden="true" />

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

                    <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 44 }}>
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
                          <div className="home-project-card project-table-card">
                            <div className="project-table-card-header">
                              <h2>Attributes</h2>
                              <button
                                type="button"
                                className="btn btn--primary project-table-header-icon-button"
                                onClick={openRelationshipWorkspaceAttributeModal}
                                disabled={graphSubmitting || relationshipWorkspaceAttributeTypeOptions.length === 0}
                                title="Add attribute"
                                aria-label="Add attribute"
                              >
                                <PlusIcon className="project-table-header-icon" />
                              </button>
                            </div>
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
                                      className={`users-th case-attributes-value-col case-attributes-value-col--editable${relationshipAttributeSortCol === definition.id ? " users-th--sorted" : ""}${hoveredRelationshipAttributeColumnId === definition.id ? " case-attributes-col--hovered" : ""}`}
                                      onMouseEnter={() => setHoveredRelationshipAttributeColumnId(definition.id)}
                                      onMouseLeave={() => setHoveredRelationshipAttributeColumnId(null)}
                                      onClick={() => {
                                        if (!canManageSources) return;
                                        setBulkRelationshipAttributeDefinition(definition);
                                        setGraphError("");
                                        setGraphNotice("");
                                      }}
                                      title={canManageSources ? "Edit values for this attribute" : "Only project owners, administrators, or editors can edit relationship attributes."}
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
                                            className={`users-td case-attributes-value-cell${cellActive ? " case-attributes-cell--active" : ""}${hoveredRelationshipAttributeColumnId === definition.id ? " case-attributes-col--hovered" : ""}`}
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
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="home-project-card project-table-card">
                        <div className="project-table-card-header">
                          <h2>Relationships</h2>
                          <button
                            type="button"
                            className="btn btn--primary project-table-header-icon-button"
                            aria-label="New relationship"
                            title="New relationship"
                            onClick={() => openCreateRelationshipModal()}
                          >
                            <PlusIcon className="project-table-header-icon" />
                          </button>
                        </div>
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
                            {filteredRelationships.length === 0 ? (
                              <tr>
                                <td colSpan={4} className="users-td-msg">
                                  {selectedRelationshipTypeFilter === "all"
                                    ? "No relationships yet."
                                    : `No ${relationshipTypeById.get(selectedRelationshipTypeFilter)?.name ?? "selected"} relationships yet.`}
                                </td>
                              </tr>
                            ) : filteredRelationships.map((relationship) => {
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
                      </div>
                    )}
                  </section>
                </div>
              </div>
              {editingRelationshipTypeModalId ? (
                renderRelationshipTypeModal({
                  title: "Edit relationship type",
                  relationshipTypeId: editingRelationshipTypeModalId,
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
                    <GraphConfirmModal
                      title="Delete relationship type"
                      warning={`This will delete the relationship type, its shared attribute definitions, and all ${affectedRelationshipCount} relationships of this type. This cannot be undone.`}
                      busy={graphSubmitting}
                      confirmLabel="Delete relationship type"
                      busyLabel="Deleting..."
                      onClose={() => setRemovingRelationshipTypeId(null)}
                      onConfirm={() => void handleDeleteRelationshipType(relationshipTypeRecord.id)}
                    >
                        <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                          Delete <strong>{relationshipTypeRecord.name}</strong>?
                        </p>
                    </GraphConfirmModal>
                  );
                })()
              ) : null}
              {removingRelationshipId ? (
                (() => {
                  const relationship = relationships.find((entry) => entry.id === removingRelationshipId);
                  if (!relationship) return null;
                  return (
                    <GraphConfirmModal
                      title="Delete relationship"
                      warning="This permanently removes the link between the connected objects."
                      busy={graphSubmitting}
                      confirmLabel="Delete relationship"
                      busyLabel="Deleting..."
                      onClose={() => setRemovingRelationshipId(null)}
                      onConfirm={() => void handleDeleteRelationship(relationship.id)}
                    >
                        <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                          Delete <strong>{relationship.relationshipType}</strong>?
                        </p>
                    </GraphConfirmModal>
                  );
                })()
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
              {bulkRelationshipAttributeDefinition ? (
                <AttributeValuesModal
                  draft={bulkRelationshipAttributeDefinition}
                  rows={sortedRelationshipAttributeRows.map((row) => ({ id: row.id, name: row.name }))}
                  initialValuesByOwner={Object.fromEntries(
                    sortedRelationshipAttributeRows.map((row) => [
                      row.id,
                      row.valuesByDefinitionId[bulkRelationshipAttributeDefinition.id] ?? "",
                    ]),
                  )}
                  saving={graphSubmitting}
                  error={graphError}
                  onCancel={() => {
                    if (graphSubmitting) return;
                    setBulkRelationshipAttributeDefinition(null);
                    setGraphError("");
                  }}
                  onSave={(_, valuesByOwner) => {
                    void handleSaveBulkRelationshipAttributeValues(bulkRelationshipAttributeDefinition, valuesByOwner);
                  }}
                  emptyStateLabel="Create a relationship first to start assigning attribute values."
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
                onOpenCreateObjectType={openCreateObjectTypeModal}
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
                  const appearance = getPostgresObjectAppearance(object, objectTypeRecord);
                  return appearance.sourceImage
                    ? getSourceCanvasNodeDefaultDimensions()
                    : getCanvasNodeDefaultDimensions(appearance.shape);
                }}
                getNodeRenderedDimensions={(object, objectTypeRecord, nodeState) => {
                  const appearance = getPostgresObjectAppearance(object, objectTypeRecord);
                  return appearance.sourceImage
                    ? getSourceCanvasNodeRenderedDimensions(nodeState)
                    : getCanvasNodeRenderedDimensions(appearance.shape, nodeState);
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
              <PostgresAppSettingsViewLazy
                authSession={authSession}
                project={project}
                canManageProject={canManageProjectSettings}
                canEditProjectMetadata={canEditProjectMetadata}
                memberCount={users.length}
                ownerCount={ownerCount}
                objectCount={objects.length}
                relationshipCount={relationships.length}
                onProjectUpdated={onProjectUpdated}
                onProjectDeleted={onProjectDeleted}
                onProjectOpened={onProjectOpened}
                onAuthSessionUpdated={onAuthSessionUpdated}
                onAuthSessionInvalidated={onAuthSessionInvalidated}
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
          {homeCanvasContextMenu ? (
            <div
              className="context-menu"
              data-home-canvas-context-menu
              role="menu"
              style={{ left: homeCanvasContextMenu.x, top: homeCanvasContextMenu.y, minWidth: 174 }}
            >
              {homeCanvasContextMenu.kind === "background" ? (
                <>
                  <button
                    type="button"
                    className={canManageSources ? "context-menu-item" : "context-menu-item context-menu-item--disabled"}
                    disabled={!canManageSources}
                    onClick={() => {
                      closeHomeCanvasContextMenu();
                      openCreateSourceModal();
                    }}
                  >
                    Add source
                  </button>
                  <button
                    type="button"
                    className={canManageSources ? "context-menu-item" : "context-menu-item context-menu-item--disabled"}
                    disabled={!canManageSources}
                    onClick={() => {
                      const preferredPosition = homeCanvasContextMenu.canvasPosition ?? undefined;
                      closeHomeCanvasContextMenu();
                      openCreateObjectModal(undefined, preferredPosition);
                    }}
                  >
                    Add object
                  </button>
                  <button
                    type="button"
                    className={canManageSources ? "context-menu-item" : "context-menu-item context-menu-item--disabled"}
                    disabled={!canManageSources}
                    onClick={() => {
                      closeHomeCanvasContextMenu();
                      openCreateRelationshipModal();
                    }}
                  >
                    Add relationship
                  </button>
                  <button
                    type="button"
                    className={canManageAnnotations ? "context-menu-item" : "context-menu-item context-menu-item--disabled"}
                    disabled={!canManageAnnotations}
                    onClick={() => {
                      closeHomeCanvasContextMenu();
                      openCreateCodeModal();
                    }}
                  >
                    Add code
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="context-menu-item"
                    onClick={() => viewHomeCanvasItem(homeCanvasContextMenu)}
                  >
                    View details
                  </button>
                  {homeCanvasContextMenu.kind === "annotation" ? (
                    <div className="context-menu-item context-menu-item--disabled">Edit</div>
                  ) : (
                    <button
                      type="button"
                      className={
                        homeCanvasContextMenu.kind === "code"
                          ? canManageAnnotations
                            ? "context-menu-item"
                            : "context-menu-item context-menu-item--disabled"
                          : canManageSources
                            ? "context-menu-item"
                            : "context-menu-item context-menu-item--disabled"
                      }
                      disabled={homeCanvasContextMenu.kind === "code" ? !canManageAnnotations : !canManageSources}
                      onClick={() => editHomeCanvasItem(homeCanvasContextMenu)}
                    >
                      Edit
                    </button>
                  )}
                  {getHomeCanvasDeleteTarget(homeCanvasContextMenu) ? (
                    <button
                      type="button"
                      className={canDeleteHomeCanvasItems ? "context-menu-item context-menu-item--danger" : "context-menu-item context-menu-item--disabled"}
                      disabled={!canDeleteHomeCanvasItems}
                      title={!canDeleteHomeCanvasItems ? "Coders and viewers cannot delete canvas items." : undefined}
                      onClick={() => startHomeCanvasDelete(homeCanvasContextMenu)}
                    >
                      Delete
                    </button>
                  ) : (
                    <div className="context-menu-item context-menu-item--disabled">Delete</div>
                  )}
                </>
              )}
            </div>
          ) : null}
          {createRelationshipTypeOpen ? (
            renderRelationshipTypeModal({
              title: "Add relationship type",
              relationshipTypeId: null,
              submitLabel: "Add relationship type",
              ariaLabel: "Add relationship type tabs",
              onClose: () => setCreateRelationshipTypeOpen(false),
              onSubmit: handleCreateRelationshipType,
            })
          ) : null}
          {objectTypeAttributeModalDraft ? (
            <AttributeDefinitionModal
              draft={objectTypeAttributeModalDraft}
              saving={graphSubmitting}
              error={typeAttributeModalError}
              title={objectTypeAttributeModalDraft.id ? "Edit object attribute" : "Create object attribute"}
              overlayStyle={{ zIndex: 300 }}
              onCancel={() => {
                if (graphSubmitting) return;
                setObjectTypeAttributeModalDraft(null);
                setTypeAttributeModalError("");
              }}
              onSave={saveObjectTypeAttributeDraft}
            />
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
          {saveFreeDrawModalOpen ? (
            <SettingsModal
              title="Save canvas"
              onClose={() => setSaveFreeDrawModalOpen(false)}
              closeDisabled={freeDrawSaving}
              modalClassName="modal--wide"
            >
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleSaveFreeDrawCanvas();
                  }}
                >
                  <div className="app-settings-modal-body">
                    <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                      Choose a name for this saved canvas.
                    </p>
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
                  </div>
                  <div className="app-settings-modal-footer">
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
            </SettingsModal>
          ) : null}
          {exportingSavedDrawingId ? (
            (() => {
              const drawing = savedDrawings.find((entry) => entry.id === exportingSavedDrawingId);
              if (!drawing) return null;
              return (
                <SettingsModal
                  title="Export saved canvas"
                  onClose={() => setExportingSavedDrawingId(null)}
                  closeDisabled={savedDrawingExportBusyFormat !== null}
                  modalClassName="modal--wide"
                >
                  <div className="app-settings-modal-body">
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
                  </div>
                    <div className="app-settings-modal-footer">
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setExportingSavedDrawingId(null)}
                        disabled={savedDrawingExportBusyFormat !== null}
                      >
                        Cancel
                      </button>
                    </div>
                </SettingsModal>
              );
            })()
          ) : null}
          {removingSavedDrawingId ? (
            (() => {
              const drawing = savedDrawings.find((entry) => entry.id === removingSavedDrawingId);
              if (!drawing) return null;
              return (
                <GraphConfirmModal
                  title="Delete saved canvas"
                  warning="This permanently removes the saved canvas from this project."
                  busy={graphSubmitting}
                  confirmLabel="Delete saved canvas"
                  busyLabel="Deleting..."
                  onClose={() => setRemovingSavedDrawingId(null)}
                  onConfirm={() => void handleDeleteSavedDrawing(drawing.id)}
                >
                    <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                      Delete <strong>{drawing.name}</strong>?
                    </p>
                </GraphConfirmModal>
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
          {createSourceOpen ? (
            <SourceImportModal
              importSettings={sourceImportSettings}
              saving={graphSubmitting}
              error={graphError || null}
              onCancel={() => {
                if (graphSubmitting) return;
                setCreateSourceOpen(false);
                setGraphError("");
              }}
              onSave={handleCreateSource}
            />
          ) : null}
          {editingHomeCanvasSource ? (
            <SourceEditorModal
              title="Edit Source"
              initialRow={editingHomeCanvasSource}
              attributeDefinitions={sourceAttributeDefinitions}
              attributeValuesByDefinitionId={homeCanvasSourceAttributeDraftValuesFor(editingHomeCanvasSource)}
              saving={graphSubmitting}
              error={graphError || null}
              onCancel={() => {
                if (graphSubmitting) return;
                setEditingHomeCanvasSourceId(null);
                setGraphError("");
              }}
              onSave={handleUpdateHomeCanvasSource}
            />
          ) : null}
          {createCodeOpen ? (
            <NewCodeModal
              allCodes={codeRowsForModal}
              title="New Code"
              submitLabel="Create"
              onSubmit={handleCreateCode}
              onDone={() => setCreateCodeOpen(false)}
              onClose={() => {
                if (graphSubmitting) return;
                setCreateCodeOpen(false);
                setGraphError("");
              }}
            />
          ) : null}
          {editingHomeCanvasCode ? (
            <NewCodeModal
              allCodes={codeRowsForModal}
              title="Edit Code"
              submitLabel="Save"
              initialLabel={editingHomeCanvasCode.label}
              initialDescription={editingHomeCanvasCode.description}
              initialColor={editingHomeCanvasCode.color}
              initialParentId={editingHomeCanvasCode.parentCodeId ?? ""}
              excludeCodeId={editingHomeCanvasCode.id}
              onSubmit={handleUpdateHomeCanvasCode}
              onDone={() => setEditingHomeCanvasCodeId(null)}
              onClose={() => {
                if (graphSubmitting) return;
                setEditingHomeCanvasCodeId(null);
                setGraphError("");
              }}
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
              outlineColorOverride: objectOutlineColorOverride,
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
              setOutlineColorOverride: setObjectOutlineColorOverride,
              setShapeOverride: setObjectShapeOverride,
              setFillOverride: setObjectFillOverride,
              setImageStoragePath: setObjectImageStoragePath,
              setGraphicMode: setObjectGraphicMode,
              setAttributeValues: setObjectAttributeValues,
              onImportImage: () => void handlePickPendingObjectImage(),
              onRemoveImage: handleRemovePendingObjectImage,
              onClearPendingImage: handleRemovePendingObjectImage,
              onNewObjectType: openCreateObjectTypeModal,
            })
          ) : null}
          {createObjectTypeOpen ? renderCreateObjectTypeModal() : null}
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
              outlineColorOverride: editingObjectOutlineColorOverride,
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
              setOutlineColorOverride: setEditingObjectOutlineColorOverride,
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
                <GraphConfirmModal
                  title="Delete object"
                  warning="This permanently removes the object and any relationships connected to it."
                  busy={graphSubmitting}
                  confirmLabel="Delete object"
                  busyLabel="Deleting..."
                  onClose={() => setRemovingObjectId(null)}
                  onConfirm={() => void handleDeleteObject(object.id)}
                >
                    <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                      Delete <strong>{object.title}</strong>?
                    </p>
                </GraphConfirmModal>
              );
            })()
          ) : null}
          {editingRelationshipId ? (
            <PostgresRelationshipModal
              title="Edit relationship"
              ariaLabel="Edit relationship tabs"
              tab={editRelationshipModalTab}
              setTab={setEditRelationshipModalTab}
              submitLabel="Save"
              relationshipTypes={relationshipTypes}
              relationshipTypeId={editingRelationshipTypeId}
              setRelationshipTypeId={setEditingRelationshipTypeId}
              selectedType={editingRelationshipTypeRecord}
              fromEndpointKey={editingRelationshipFromObjectId}
              setFromEndpointKey={setEditingRelationshipFromObjectId}
              toEndpointKey={editingRelationshipToObjectId}
              setToEndpointKey={setEditingRelationshipToObjectId}
              availableFromEndpoints={availableEditingFromEndpointOptions}
              availableToEndpoints={availableEditingToEndpointOptions}
              description={editingRelationshipDescription}
              setDescription={setEditingRelationshipDescription}
              lineShapeOverride={editingRelationshipLineShapeOverride}
              setLineShapeOverride={setEditingRelationshipLineShapeOverride}
              lineWeightOverride={editingRelationshipLineWeightOverride}
              setLineWeightOverride={setEditingRelationshipLineWeightOverride}
              arrowheadOverride={editingRelationshipArrowheadOverride}
              setArrowheadOverride={setEditingRelationshipArrowheadOverride}
              colorOverride={editingRelationshipColorOverride}
              setColorOverride={setEditingRelationshipColorOverride}
              attributeDefinitions={relationshipAttributeDefinitionsForEditingType}
              attributeValues={editingRelationshipAttributeValues}
              setAttributeValues={setEditingRelationshipAttributeValues}
              submitting={graphSubmitting}
              error={graphError || null}
              submitDisabled={!editingRelationshipFromObjectId || !editingRelationshipToObjectId}
              onClose={() => setEditingRelationshipId(null)}
              onSubmit={(event) => {
                void handleSaveRelationship(event);
              }}
              onNewRelationshipType={() => setCreateRelationshipTypeOpen(true)}
            />
          ) : null}
          {(activeScreen !== "relationships" || selectedRelationshipDetails) && removingRelationshipId ? (
            (() => {
              const relationship = relationships.find((entry) => entry.id === removingRelationshipId);
              if (!relationship) return null;
              return (
                <GraphConfirmModal
                  title="Delete relationship"
                  warning="This permanently removes the link between the connected objects."
                  busy={graphSubmitting}
                  confirmLabel="Delete relationship"
                  busyLabel="Deleting..."
                  onClose={() => setRemovingRelationshipId(null)}
                  onConfirm={() => void handleDeleteRelationship(relationship.id)}
                >
                    <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                      Delete <strong>{relationship.relationshipType}</strong>?
                    </p>
                </GraphConfirmModal>
              );
            })()
          ) : null}
          {homeCanvasDeleteTarget ? (
            <GraphConfirmModal
              title={`Delete ${homeCanvasDeleteTarget.kind}`}
              warning={(
                <>
                  This permanently removes the {homeCanvasDeleteTarget.kind}
                  {homeCanvasDeleteTarget.kind === "object"
                    ? " and any relationships connected to it."
                    : homeCanvasDeleteTarget.kind === "source"
                      ? " and its related project records."
                      : homeCanvasDeleteTarget.kind === "code"
                        ? " and its coding assignments."
                        : "."}
                </>
              )}
              busy={graphSubmitting}
              confirmLabel="Delete"
              busyLabel="Deleting..."
              confirmDisabled={!canDeleteHomeCanvasItems}
              onClose={() => setHomeCanvasDeleteTarget(null)}
              onConfirm={() => {
                if (canDeleteHomeCanvasItems) void handleConfirmHomeCanvasDelete();
              }}
            >
                <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                  Delete <strong>{homeCanvasDeleteTarget.label}</strong>?
                </p>
            </GraphConfirmModal>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function ViewLoadingFallback() {
  return (
    <div className="view-loading-state">
      <LoadingCard />
    </div>
  );
}
