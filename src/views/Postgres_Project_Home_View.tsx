import {
  type ComponentType,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  Suspense,
  lazy,
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
import { HelpIcon, PlusIcon } from "../components/AppIcons";
import { GettingStartedGuideCallout } from "../components/GettingStartedGuideCallout";
import type { EditableAttributeMatrixValues } from "../components/EditableAttributesMatrix";
import { SettingsModal } from "../components/SettingsModal";
import type { SourceEditorPayload, SourceRow } from "./Postgres_Sources_View";
import { NewCodeModal, type CodeRow } from "../components/NewCodeModal";
import { formatCurrentDateTime } from "../i18n/formatters";
import { useI18n } from "../i18n/provider";
import type { TranslationKey } from "../i18n/types";
import { readAppSettings } from "../lib/appSettings";
import {
  DEFAULT_GETTING_STARTED_STATE,
  normalizeGettingStartedState,
  type GettingStartedState,
} from "../lib/gettingStartedGuide";
import { inferUploadMediaType } from "../lib/sourceUploadMedia";
import {
  DEFAULT_CANVAS_GRID_DENSITY,
  DEFAULT_CANVAS_GRID_ENABLED,
  applyCanvasSettings,
  getAppDefaults,
  getStoredCanvasGridDensity,
  getStoredCanvasGridEnabled,
  getStoredOverrides,
  getStoredTheme,
  getStoredThemeState,
  saveOverrides,
} from "../theme";
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
  getPostgresUserPreferences,
  getPostgresSavedDrawing,
  getPostgresStatus,
  importPostgresSourceFile,
  importPostgresSourceImage,
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
  listPostgresTimelineGroups,
  listPostgresTimelineGroupRowOrders,
  listPostgresTimelineItemGroupAssignments,
  listPostgresSourceAttributeDefinitions,
  listPostgresSourceAttributeValues,
  listPostgresSources,
  listPostgresSourceTypeSettings,
  reorderPostgresTimelineGroups,
  reorderPostgresTimelineGroupRows,
  savePostgresObject,
  savePostgresObjectType,
  savePostgresProjectCanvasState,
  savePostgresUserPreferences,
  savePostgresRelationship,
  savePostgresRelationshipType,
  savePostgresSavedDrawing,
  savePostgresSourceAttribute,
  savePostgresTimelineGroup,
  setPostgresTimelineItemGroup,
  deletePostgresTimelineGroup,
  removePostgresObjectImage,
  removePostgresObjectTypeImage,
  removePostgresSourceImage,
  updatePostgresCode,
  updatePostgresSource,
  updatePostgresRelationshipAttributeDefinition,
  type PostgresAuthSession,
  type PostgresAnnotationSummary,
  type PostgresCanvasNodeState,
  type PostgresCanvasPoint,
  type PostgresCanvasShape,
  type PostgresProjectCanvasState,
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
  type PostgresTimelineGroup,
  type PostgresTimelineGroupRowOrder,
  type PostgresTimelineItemGroupAssignment,
  POSTGRES_PROJECT_CHANGED_EVENT,
} from "../lib/postgres";
import type {
  ProjectEmbeddingBuildStatus,
  ProjectEmbeddingStoreStatus,
} from "../lib/projectEmbeddings";
import {
  AttributeValuesModal,
  type SharedAttributeDraft,
} from "../components/AttributeValuesModal";
import {
  ObjectShapeSwatch,
  RelationshipTypeLinePreview,
} from "../components/PostgresGraphicsControls";
import {
  PostgresCanvasAppearanceModal,
  isPostgresHomeCanvasHexColor,
  type PostgresHomeCanvasAppearanceDraft,
} from "../components/PostgresCanvasAppearanceModal";
import {
  PostgresObjectModal,
  type PostgresObjectInstanceGraphicMode,
} from "../components/PostgresObjectModal";
import {
  PostgresObjectTypeModal,
  type PostgresObjectGraphicMode,
} from "../components/PostgresObjectTypeModal";
import {
  PostgresRelationshipTypeModal,
  type PostgresRelationshipEndpointRestrictionItem,
  type PostgresRelationshipTypeModalTab,
} from "../components/PostgresRelationshipTypeModal";
import {
  PostgresHomeCanvasContextMenu,
  type PostgresHomeCanvasContextMenuState,
  type PostgresHomeCanvasDeleteTarget,
} from "../components/PostgresHomeCanvasContextMenu";
import {
  POSTGRES_IMAGE_MAX_BYTES,
  PostgresImageCropModal,
  bytesToBase64,
  cropPostgresImageUpload,
  formatPostgresFileSize,
  getFileNameFromPath,
  sanitizeFileStem,
  type PostgresImageCropDraft,
  type PostgresImageUploadDraft,
} from "../components/PostgresImageCropModal";
import {
  PostgresAttributeValueHistoryModal,
  type PostgresAttributeValueHistoryTarget,
} from "../components/PostgresAttributeValueHistoryModal";
import { AttributeDefinitionModal } from "../components/AttributeDefinitionModal";
import { LoadingCard } from "../components/LoadingCard";
import { usePostgresAutomaticProjectSnapshots } from "../hooks/usePostgresAutomaticProjectSnapshots";
import { OPEN_PROJECT_SETTINGS_MODAL_EVENT } from "../lib/projectBackupBanner";
import {
  type PostgresRelationshipEndpointOption as SharedPostgresRelationshipEndpointOption,
  type PostgresRelationshipModalTab,
} from "../components/PostgresRelationshipModal";
import { PostgresHomeRelationshipModals } from "../components/PostgresHomeRelationshipModals";
import { PostgresSidebar } from "./Postgres_Sidebar";
import type {
  PostgresSidebarAiStatus,
  PostgresSidebarCollaborationStatus,
  PostgresSidebarNetworkMode,
} from "./Postgres_Sidebar";
import type { PostgresMemoDraftTarget } from "./Postgres_Project_Memos_View";
import {
  GraphConfirmModal,
  TypeScopedAttributeModal,
  type TypeScopedAttributeDraft,
} from "./Postgres_Project_Home_Modals";
import {
  PostgresHomeAnnotationImagePreview,
  truncatePostgresHomeAnnotationPreview,
} from "./Postgres_Project_Home_Graph_Inspector";
import {
  TIMELINE_FIELD_OPTIONS,
  createTypeAttributeDraft,
  defaultTimelineAttributeOptions,
  formatTimelineModalDateTime,
  type TypeAttributeDraft,
  type TimelineFieldRole,
} from "./Postgres_Project_Home_Timeline_Fields";
import {
  POSTGRES_OBJECT_TYPE_DEFAULT_COLOR,
  POSTGRES_OBJECT_TYPE_DEFAULT_FILL_TRANSPARENCY,
  POSTGRES_OBJECT_TYPE_DEFAULT_OUTLINE_WIDTH,
  POSTGRES_RELATIONSHIP_DEFAULT_COLOR,
  POSTGRES_SOURCE_KIND_OPTIONS,
  formatPostgresObjectFillLabel,
  formatPostgresObjectShapeLabel,
  getCanvasNodeDefaultDimensions,
  getCanvasNodeRenderedDimensions,
  getPostgresObjectAppearance,
  getPostgresObjectSurfaceStyle,
  getPostgresRelationshipAppearance,
  getPostgresRelationshipStrokeDasharray,
  getPostgresRelationshipStrokeWidth,
  getPostgresSourceObjectVisualKey,
  isPostgresSourceObjectVisualKey,
  normalizeOptionalPostgresObjectTypeColor,
  normalizeOptionalPostgresRelationshipColor,
  normalizePostgresObjectFill,
  normalizePostgresObjectFillTransparency,
  normalizePostgresObjectOutlineWidth,
  normalizePostgresObjectTypeColor,
  normalizePostgresObjectTypeShape,
  normalizePostgresRelationshipArrowhead,
  normalizePostgresRelationshipColor,
  normalizePostgresRelationshipLineShape,
  normalizePostgresRelationshipLineWeight,
  renderSvgObjectShape,
  resolvePostgresObjectColor,
  resolvePostgresObjectFill,
  resolvePostgresObjectOutlineColor,
  resolvePostgresObjectShape,
  type PostgresObjectFill,
  type PostgresObjectTypeShape,
  type PostgresRelationshipArrowhead,
  type PostgresRelationshipLineShape,
} from "../lib/postgresGraphics";
import {
  escapeSvgText,
  renderCanvasSketchShapeSvg,
} from "../lib/postgresCanvasSketch";
import {
  getPostgresImageMimeType,
  usePostgresStoredImageUrlMap,
} from "../lib/postgresStoredImages";

const PostgresAppSettingsViewLazy = lazy(
  () => import("./Postgres_App_Settings_View").then((m) => ({ default: m.PostgresAppSettingsView })),
);
const PostgresUserSettingsViewLazy = lazy(
  () => import("./Postgres_User_Settings_View").then((m) => ({ default: m.PostgresUserSettingsView })),
);
const PostgresProjectSourcesViewLazy = lazy(
  () => import("./Postgres_Project_Sources_View").then((m) => ({ default: m.PostgresProjectSourcesView })),
);
const SourceImportModalLazy = lazy(
  () => import("./Postgres_Sources_View").then((m) => ({ default: m.SourceImportModal })),
);
const SourceEditorModalLazy = lazy(
  () => import("./Postgres_Sources_View").then((m) => ({ default: m.SourceEditorModal })),
);
const PostgresProjectHomeDetailsViewLazy = lazy(
  () => import("./Postgres_Project_Home_Details_View").then((m) => ({ default: m.PostgresProjectHomeDetailsView })),
);
const PostgresProjectHomeTimelineViewLazy = lazy(
  () => import("./Postgres_Project_Home_Timeline_View").then((m) => ({ default: m.PostgresProjectHomeTimelineView })),
);
const PostgresProjectHomeGraphViewLazy = lazy(
  () => import("./Postgres_Project_Home_Graph_View").then((m) => ({ default: m.PostgresProjectHomeGraphView })),
);
const PostgresAnalysisCodeSourcesViewLazy = lazy(
  () => import("./Postgres_Analysis_Code_Sources_View").then((m) => ({ default: m.PostgresAnalysisCodeSourcesView })),
);
function RemovedCanvasPlaceholder(_props: { children?: ReactNode; [key: string]: unknown }) {
  return null;
}

const PostgresAnalysisDrawViewLazy = RemovedCanvasPlaceholder;
const PostgresAnalysisDrawCanvasViewLazy = RemovedCanvasPlaceholder;
const PostgresAnalysisNetworkViewLazy = RemovedCanvasPlaceholder;
const PostgresAiAssistAssistedCodingViewLazy = lazy(
  () => import("./Postgres_AIAssist_Assisted_Coding_View").then((m) => ({ default: m.PostgresAiAssistAssistedCodingView })),
);
const PostgresFreeDrawCanvasViewLazy = RemovedCanvasPlaceholder;
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

type PostgresProjectScreen =
  | "home"
  | "users"
  | "sources"
  | "annotations"
  | "codebook"
  | "code-text"
  | "analysis-draw"
  | "analysis-draw-canvas"
  | "analysis-network"
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
  const { t } = useI18n();
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
          <h2>{t("projectCore.homeShell.postgresPort")}</h2>
        </div>
        <p className="home-project-description">
          {t("projectCore.homeShell.postgresPortDescription")}
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
type PostgresProjectHomeTab = "details" | "graph" | "timeline";
type PostgresProjectHelpModalId =
  | "home"
  | "users"
  | "objects"
  | "relationships"
  | "construct"
  | "view";

const POSTGRES_PROJECT_HELP_COPY: Record<PostgresProjectHelpModalId, { titleKey: TranslationKey; lineKeys: TranslationKey[] }> = {
  home: {
    titleKey: "projectCore.homeShell.help.homeTitle",
    lineKeys: [
      "projectCore.homeShell.help.homeLine1",
      "projectCore.homeShell.help.homeLine2",
    ],
  },
  users: {
    titleKey: "projectCore.homeShell.help.usersTitle",
    lineKeys: [
      "projectCore.homeShell.help.usersLine1",
      "projectCore.homeShell.help.usersLine2",
    ],
  },
  objects: {
    titleKey: "projectCore.homeShell.help.objectsTitle",
    lineKeys: [
      "projectCore.homeShell.help.objectsLine1",
      "projectCore.homeShell.help.objectsLine2",
    ],
  },
  relationships: {
    titleKey: "projectCore.homeShell.help.relationshipsTitle",
    lineKeys: [
      "projectCore.homeShell.help.relationshipsLine1",
      "projectCore.homeShell.help.relationshipsLine2",
    ],
  },
  construct: {
    titleKey: "projectCore.homeShell.help.constructTitle",
    lineKeys: [
      "projectCore.homeShell.help.constructLine1",
      "projectCore.homeShell.help.constructLine2",
    ],
  },
  view: {
    titleKey: "projectCore.homeShell.help.viewTitle",
    lineKeys: [
      "projectCore.homeShell.help.viewLine1",
      "projectCore.homeShell.help.viewLine2",
    ],
  },
};

function readPostgresHomeCanvasAppearanceDraft(): PostgresHomeCanvasAppearanceDraft {
  const theme = getStoredTheme();
  const colors = { ...getAppDefaults(theme), ...getStoredOverrides(theme) };
  return {
    backgroundColor: colors["--canvas-background"] ?? getAppDefaults(theme)["--canvas-background"],
    gridColor: colors["--canvas-grid-color"] ?? getAppDefaults(theme)["--canvas-grid-color"],
    gridEnabled: getStoredCanvasGridEnabled(),
    gridDensity: getStoredCanvasGridDensity(),
  };
}
type PostgresRelationshipAttributeDraft = SharedAttributeDraft;
type PostgresRelationshipEndpointOption = SharedPostgresRelationshipEndpointOption & {
  key: string;
  entityType: "object" | "source";
  entityId: string;
  name: string;
  type: string;
};
type PostgresSavedCanvasKind = "free_draw" | "explore" | "construct" | "graph_draw";

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
    case "graph_draw":
      return "Draw";
    case "explore":
      return "Explore";
    case "construct":
      return "Construct";
    default:
      return kind;
  }
}

function formatPostgresSourceKindLabel(kind: string, t: ReturnType<typeof useI18n>["t"]): string {
  switch (normalizePostgresSourceKind(kind)) {
    case "text":
      return t("projectCore.sourceKinds.text");
    case "transcript":
      return t("projectCore.sourceKinds.transcript");
    case "pdf":
      return t("projectCore.sourceKinds.pdf");
    case "image":
      return t("projectCore.sourceKinds.image");
    case "audio":
      return t("projectCore.sourceKinds.audio");
    case "video":
      return t("projectCore.sourceKinds.video");
    default:
      return kind ? kind.split(/[_\s-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") : t("projectCore.entities.source");
  }
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
  canvasKind: PostgresSavedCanvasKind;
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
  const { t } = useI18n();
  const PROJECT_ROLE_OPTIONS = ["owner", "editor", "coder", "viewer"] as const;
  const [activeScreen, setActiveScreen] = useState<PostgresProjectScreen>("home");
  const [projectHomeTab, setProjectHomeTab] = useState<PostgresProjectHomeTab>("details");
  const [projectHelpModal, setProjectHelpModal] = useState<PostgresProjectHelpModalId | null>(null);
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
  const [timelineGroups, setTimelineGroups] = useState<PostgresTimelineGroup[]>([]);
  const [timelineGroupRowOrders, setTimelineGroupRowOrders] = useState<PostgresTimelineGroupRowOrder[]>([]);
  const [timelineItemGroupAssignments, setTimelineItemGroupAssignments] = useState<PostgresTimelineItemGroupAssignment[]>([]);
  const [codes, setCodes] = useState<PostgresCode[]>([]);
  const [annotationSummaries, setAnnotationSummaries] = useState<PostgresAnnotationSummary[]>([]);
  const [memoCount, setMemoCount] = useState(0);
  const [reportCount, setReportCount] = useState(0);
  const [homeCanvasCreateMenuOpen, setHomeCanvasCreateMenuOpen] = useState(false);
  const [homeCanvasFilterDrawerOpen, setHomeCanvasFilterDrawerOpen] = useState(false);
  const [homeCanvasSizeMenuOpen, setHomeCanvasSizeMenuOpen] = useState(false);
  const [homeCanvasContextMenu, setHomeCanvasContextMenu] = useState<PostgresHomeCanvasContextMenuState | null>(null);
  const [homeCanvasAppearanceDraft, setHomeCanvasAppearanceDraft] = useState<PostgresHomeCanvasAppearanceDraft | null>(null);
  const [homeCanvasAppearanceSaving, setHomeCanvasAppearanceSaving] = useState(false);
  const [homeCanvasAppearanceError, setHomeCanvasAppearanceError] = useState("");
  const [homeCanvasDeleteTarget, setHomeCanvasDeleteTarget] = useState<PostgresHomeCanvasDeleteTarget | null>(null);
  const [createSourceOpen, setCreateSourceOpen] = useState(false);
  const [pendingTimelineCreateStart, setPendingTimelineCreateStart] = useState("");
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
  const [gettingStartedState, setGettingStartedState] = useState<GettingStartedState>(DEFAULT_GETTING_STARTED_STATE);
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
  const [objectFillTransparencyOverride, setObjectFillTransparencyOverride] = useState<number | null>(null);
  const [objectOutlineWidthOverride, setObjectOutlineWidthOverride] = useState<number | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    async function loadGettingStartedState() {
      try {
        const preferences = await getPostgresUserPreferences();
        if (!cancelled) {
          setGettingStartedState(normalizeGettingStartedState(preferences.gettingStartedState));
        }
      } catch (error) {
        console.warn("Could not load getting started guide state:", error);
      }
    }
    void loadGettingStartedState();
    return () => {
      cancelled = true;
    };
  }, []);

  async function persistGettingStartedState(nextState: Partial<GettingStartedState>) {
    const normalized = normalizeGettingStartedState({
      ...gettingStartedState,
      ...nextState,
    });
    setGettingStartedState(normalized);
    try {
      const preferences = await getPostgresUserPreferences();
      const saved = await savePostgresUserPreferences({
        ...preferences,
        gettingStartedState: normalized,
      });
      setGettingStartedState(normalizeGettingStartedState(saved.gettingStartedState));
    } catch (error) {
      console.warn("Could not save getting started guide state:", error);
    }
  }

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
  const [draftObjectTypeFillTransparency, setDraftObjectTypeFillTransparency] = useState(POSTGRES_OBJECT_TYPE_DEFAULT_FILL_TRANSPARENCY);
  const [draftObjectTypeOutlineWidth, setDraftObjectTypeOutlineWidth] = useState(POSTGRES_OBJECT_TYPE_DEFAULT_OUTLINE_WIDTH);
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
  const [editingObjectFillTransparencyOverride, setEditingObjectFillTransparencyOverride] = useState<number | null>(null);
  const [editingObjectOutlineWidthOverride, setEditingObjectOutlineWidthOverride] = useState<number | null>(null);
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
  const [selectedCanvasViewKind, setSelectedCanvasViewKind] = useState<PostgresSavedCanvasKind>("free_draw");
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
  const [relationshipTypeModalTab, setRelationshipTypeModalTab] = useState<PostgresRelationshipTypeModalTab>("details");
  const [relationshipTypeAttributeValuesByDraftId, setRelationshipTypeAttributeValuesByDraftId] = useState<EditableAttributeMatrixValues>({});
  const [relationshipTypeId, setRelationshipTypeId] = useState("");
  const [relationshipDescription, setRelationshipDescription] = useState("");
  const [relationshipLineShapeOverride, setRelationshipLineShapeOverride] = useState("");
  const [relationshipLineWeightOverride, setRelationshipLineWeightOverride] = useState<number | null>(null);
  const [relationshipArrowheadOverride, setRelationshipArrowheadOverride] = useState("");
  const [relationshipColorOverride, setRelationshipColorOverride] = useState("");
  const [relationshipAttributeValues, setRelationshipAttributeValues] = useState<Record<string, string>>({});
  const [createRelationshipOpen, setCreateRelationshipOpen] = useState(false);
  const [createRelationshipModalTab, setCreateRelationshipModalTab] = useState<PostgresRelationshipModalTab>("details");
  const [editingRelationshipId, setEditingRelationshipId] = useState<string | null>(null);
  const [editRelationshipModalTab, setEditRelationshipModalTab] = useState<PostgresRelationshipModalTab>("details");
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
  const [canvasScale, setCanvasScale] = useState(1);
  const [canvasOffset, setCanvasOffset] = useState<PostgresCanvasPoint>({ x: 140, y: 120 });
  const [canvasNodes, setCanvasNodes] = useState<Record<string, PostgresCanvasNodeState>>({});
  const [canvasShapes, setCanvasShapes] = useState<PostgresCanvasShape[]>([]);
  const [hiddenCanvasRelationshipIds, setHiddenCanvasRelationshipIds] = useState<string[]>([]);
  const [canvasRelationshipTypeId, setCanvasRelationshipTypeId] = useState("");
  const [canvasStateLoaded, setCanvasStateLoaded] = useState(false);
  const [canvasSaveError, setCanvasSaveError] = useState("");
  const [drawCanvasNodes, setDrawCanvasNodes] = useState<Record<string, PostgresCanvasNodeState>>({});
  const [drawCanvasShapes, setDrawCanvasShapes] = useState<PostgresCanvasShape[]>([]);
  const [drawCanvasHiddenRelationshipIds, setDrawCanvasHiddenRelationshipIds] = useState<string[]>([]);
  const [drawCanvasStateLoaded, setDrawCanvasStateLoaded] = useState(false);
  const [drawCanvasAutoLayoutKey, setDrawCanvasAutoLayoutKey] = useState(0);
  const [drawSavedDrawingId, setDrawSavedDrawingId] = useState<string | null>(null);
  const [drawSavedDrawingName, setDrawSavedDrawingName] = useState("");
  const [drawCanvasSaveNotice, setDrawCanvasSaveNotice] = useState("");
  const [drawCanvasSaving, setDrawCanvasSaving] = useState(false);
  const [drawCanvasSaveModalOpen, setDrawCanvasSaveModalOpen] = useState(false);
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
  const sourceTimelineStartDefinitionForKind = useCallback((sourceKind: string) => {
    const normalizedSourceKind = normalizePostgresSourceKind(sourceKind);
    return sourceAttributeDefinitions.find((definition) =>
      definition.timelineRole === "timeline_start"
      && definition.dataType === "datetime"
      && definition.sourceKinds.some((kind) => normalizePostgresSourceKind(kind) === normalizedSourceKind)
    ) ?? null;
  }, [sourceAttributeDefinitions]);
  const objectTimelineStartValuesForType = useCallback((objectTypeIdValue: string, timelineStart?: string) => {
    const formatted = formatTimelineModalDateTime(timelineStart);
    if (!formatted) return {};
    const startDefinition = objectAttributeDefinitions.find((definition) =>
      definition.objectTypeId === objectTypeIdValue
      && definition.timelineRole === "timeline_start"
      && definition.dataType === "datetime"
    );
    return startDefinition ? { [startDefinition.id]: formatted } : {};
  }, [objectAttributeDefinitions]);
  const relationshipTimelineStartValuesForType = useCallback((relationshipTypeIdValue: string, timelineStart?: string) => {
    const formatted = formatTimelineModalDateTime(timelineStart);
    if (!formatted) return {};
    const startDefinition = relationshipAttributeDefinitions.find((definition) =>
      definition.relationshipTypeId === relationshipTypeIdValue
      && definition.timelineRole === "timeline_start"
      && definition.dataType === "datetime"
    );
    return startDefinition ? { [startDefinition.id]: formatted } : {};
  }, [relationshipAttributeDefinitions]);
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
    setFreeDrawSavedDrawingId(null);
  }, []);

  const clearSavedCanvasSession = useCallback(() => {
    setSavedCanvasSession(null);
    setFreeDrawSavedDrawingId(null);
  }, []);

  const handleSaveFreeDrawCanvas = useCallback(async () => {
    const trimmedName = saveFreeDrawName.trim();
    if (!trimmedName) {
      setCanvasSaveError(t("projectCore.homeShell.savedCanvasNameRequired"));
      return;
    }
    setFreeDrawSaving(true);
    setCanvasSaveError("");
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
    } catch (error) {
      setCanvasSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setFreeDrawSaving(false);
    }
  }, [canvasNodes, canvasOffset.x, canvasOffset.y, canvasScale, canvasShapes, freeDrawSavedDrawingId, hiddenCanvasRelationshipIds, project.id, saveFreeDrawName, t]);
  const openSaveGraphDrawModal = useCallback(() => {
    setCanvasSaveError("");
    setDrawCanvasSaveNotice("");
    setSaveFreeDrawName(drawSavedDrawingName);
    setDrawCanvasSaveModalOpen(true);
  }, [drawSavedDrawingName]);
  const handleSaveGraphDrawCanvas = useCallback(async () => {
    const trimmedName = saveFreeDrawName.trim();
    if (!trimmedName) {
      setCanvasSaveError(t("projectCore.homeShell.savedDrawingNameRequired"));
      return;
    }
    setDrawCanvasSaving(true);
    setCanvasSaveError("");
    setDrawCanvasSaveNotice("");
    try {
      const state: PostgresProjectCanvasState = {
        viewport: {
          x: 0,
          y: 0,
          zoom: 1,
        },
        nodes: Object.values(drawCanvasNodes),
        shapes: drawCanvasShapes,
        hiddenRelationshipIds: drawCanvasHiddenRelationshipIds,
      };
      const saved = await savePostgresSavedDrawing({
        projectId: project.id,
        drawingId: drawSavedDrawingId,
        name: trimmedName,
        canvasKind: "graph_draw",
        state,
      });
      setDrawSavedDrawingId(saved.id);
      setDrawSavedDrawingName(saved.name);
      setSavedDrawings((current) => {
        const next = current.filter((entry) => entry.id !== saved.id);
        return [saved, ...next];
      });
      setDrawCanvasSaveModalOpen(false);
      setDrawCanvasSaveNotice(t("projectCore.homeShell.savedDrawingNotice", { name: saved.name }));
    } catch (error) {
      setCanvasSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setDrawCanvasSaving(false);
    }
  }, [
    drawCanvasHiddenRelationshipIds,
    drawCanvasNodes,
    drawCanvasShapes,
    drawSavedDrawingId,
    project.id,
    saveFreeDrawName,
    t,
  ]);
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
          type: formatPostgresSourceKindLabel(source.sourceKind, t),
        })),
    ].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  }, [objects, selectedRelationshipType, sources, t]);
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
          type: formatPostgresSourceKindLabel(source.sourceKind, t),
        })),
    ].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  }, [objects, selectedRelationshipType, sources, t]);
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
          type: formatPostgresSourceKindLabel(source.sourceKind, t),
        })),
    ].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  }, [editingRelationshipTypeRecord, objects, sources, t]);
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
          type: formatPostgresSourceKindLabel(source.sourceKind, t),
        })),
    ].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  }, [editingRelationshipTypeRecord, objects, sources, t]);

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
      sourceObjectType: formatPostgresSourceKindLabel(source.sourceKind, t),
      sourceObjectTypeSystemKey: getPostgresSourceKindOption(source.sourceKind)?.sourceVisualKey ?? null,
      notes: source.notes,
      content: source.textContent,
      structuredContentJson: source.structuredContentJson,
      waveformPeaksJson: source.waveformPeaksJson,
      videoFrameIndexJson: source.videoFrameIndexJson,
      extractedFromVideoSourceId: source.extractedFromVideoSourceId,
      extractedFromVideoTimeMs: source.extractedFromVideoTimeMs,
      filePath: source.storagePath || source.originalFileName,
      shapeOverride: source.shapeOverride ?? "",
      colorOverride: source.colorOverride ?? "",
      outlineColorOverride: source.outlineColorOverride ?? "",
      fillOverride: source.fillOverride ?? "",
      fillTransparencyOverride: source.fillTransparencyOverride ?? null,
      outlineWidthOverride: source.outlineWidthOverride ?? null,
      imageStoragePath: source.imageStoragePath ?? "",
      annotationCount: annotationSummaries.filter((annotation) => annotation.sourceId === source.id).length,
      objectCount: 0,
      createdAt: source.createdAt,
    })),
    [annotationSummaries, sources, t],
  );
  const editingHomeCanvasSource = editingHomeCanvasSourceId
    ? sourceRowsForEditor.find((source) => source.id === editingHomeCanvasSourceId) ?? null
    : null;
  const editingHomeCanvasCode = editingHomeCanvasCodeId
    ? codes.find((code) => code.id === editingHomeCanvasCodeId) ?? null
    : null;

  function openCreateSourceModal(timelineStart?: string) {
    setGraphError("");
    setHomeCanvasCreateMenuOpen(false);
    setPendingTimelineCreateStart(formatTimelineModalDateTime(timelineStart));
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
    setDraftObjectTypeFillTransparency(POSTGRES_OBJECT_TYPE_DEFAULT_FILL_TRANSPARENCY);
    setDraftObjectTypeOutlineWidth(POSTGRES_OBJECT_TYPE_DEFAULT_OUTLINE_WIDTH);
    setDraftObjectTypeImageStoragePath("");
    setDraftObjectTypePendingImage(null);
    setDraftObjectTypeGraphicMode("select");
    initializeObjectTypeAttributeEditor(null);
    setObjectTypeModalTab("details");
    setGraphError("");
    setCreateObjectTypeOpen(true);
  }

  function openCreateObjectModal(prefilledTypeId?: string, preferredPosition?: PostgresCanvasPoint, timelineStart?: string) {
    const formattedTimelineStart = formatTimelineModalDateTime(timelineStart);
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
    setObjectFillTransparencyOverride(null);
    setObjectOutlineWidthOverride(null);
    setObjectImageStoragePath("");
    setDraftObjectPendingImage(null);
    setObjectGraphicMode("inherit");
    setObjectAttributeValues(objectTimelineStartValuesForType(nextTypeId || objectTypes[0]?.id || "", formattedTimelineStart));
    setCreateObjectModalTab("details");
    setGraphError("");
    setPendingTimelineCreateStart(formattedTimelineStart);
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
    setEditingObjectFillTransparencyOverride(object.fillTransparencyOverride ?? null);
    setEditingObjectOutlineWidthOverride(object.outlineWidthOverride ?? null);
    setEditingObjectImageStoragePath(object.imageStoragePath ?? "");
    setEditingObjectGraphicMode(
      object.imageStoragePath
        ? "upload"
        : object.shapeOverride || object.colorOverride || object.outlineColorOverride || object.fillOverride || object.fillTransparencyOverride !== null || object.outlineWidthOverride !== null
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
    setDraftObjectTypeFillTransparency(
      normalizePostgresObjectFillTransparency(objectTypeRecord.fillTransparency),
    );
    setDraftObjectTypeOutlineWidth(
      normalizePostgresObjectOutlineWidth(objectTypeRecord.outlineWidth),
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

  function openCreateRelationshipModal(prefill?: { fromEndpointKey?: string; toEndpointKey?: string; timelineStart?: string }) {
    const formattedTimelineStart = formatTimelineModalDateTime(prefill?.timelineStart);
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
    setRelationshipAttributeValues(relationshipTimelineStartValuesForType(nextRelationshipTypeId, formattedTimelineStart));
    setGraphError("");
    setPendingTimelineCreateStart(formattedTimelineStart);
    setCreateRelationshipOpen(true);
  }

  function setCreateObjectTypeId(nextValue: SetStateAction<string>) {
    const nextTypeId = typeof nextValue === "function" ? nextValue(objectTypeId) : nextValue;
    setObjectTypeId(nextValue);
    if (!pendingTimelineCreateStart) return;
    setObjectAttributeValues((current) => ({
      ...current,
      ...objectTimelineStartValuesForType(nextTypeId, pendingTimelineCreateStart),
    }));
  }

  function setCreateRelationshipTypeId(nextValue: SetStateAction<string>) {
    const nextTypeId = typeof nextValue === "function" ? nextValue(relationshipTypeId) : nextValue;
    setRelationshipTypeId(nextValue);
    if (!pendingTimelineCreateStart) return;
    setRelationshipAttributeValues((current) => ({
      ...current,
      ...relationshipTimelineStartValuesForType(nextTypeId, pendingTimelineCreateStart),
    }));
  }

  async function applyTimelineStartToCreatedSources(createdSources: PostgresSource[], timelineStart: string) {
    if (!timelineStart || createdSources.length === 0) return;
    const createdByDefinitionId = new Map<string, PostgresSource[]>();
    for (const source of createdSources) {
      const definition = sourceTimelineStartDefinitionForKind(source.sourceKind);
      if (!definition) continue;
      const current = createdByDefinitionId.get(definition.id) ?? [];
      current.push(source);
      createdByDefinitionId.set(definition.id, current);
    }
    for (const [definitionId, matchingSources] of createdByDefinitionId) {
      const definition = sourceAttributeDefinitions.find((entry) => entry.id === definitionId);
      if (!definition) continue;
      await savePostgresSourceAttribute({
        projectId: project.id,
        attributeDefinitionId: definition.id,
        name: definition.name,
        dataType: definition.dataType,
        description: definition.description,
        options: definition.options,
        timelineRole: definition.timelineRole ?? "",
        sourceKinds: definition.sourceKinds,
        values: sources
          .map((source) => ({
            sourceId: source.id,
            value: sourceAttributeValues.find((value) =>
              value.sourceId === source.id && value.attributeDefinitionId === definition.id
            )?.value ?? "",
          }))
          .concat(matchingSources.map((source) => ({ sourceId: source.id, value: timelineStart }))),
      });
      setSourceAttributeValues((current) => {
        const matchingSourceIds = new Set(matchingSources.map((source) => source.id));
        return current
          .filter((value) => !(matchingSourceIds.has(value.sourceId) && value.attributeDefinitionId === definition.id))
          .concat(matchingSources.map((source) => ({
            id: `${source.id}:${definition.id}`,
            sourceId: source.id,
            attributeDefinitionId: definition.id,
            attributeName: definition.name,
            dataType: definition.dataType,
            value: timelineStart,
            sortOrder: definition.sortOrder,
          })));
      });
    }
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

  function applyHomeCanvasAppearanceDraft(nextDraft: PostgresHomeCanvasAppearanceDraft) {
    if (isPostgresHomeCanvasHexColor(nextDraft.backgroundColor)) {
      document.documentElement.style.setProperty("--canvas-background", nextDraft.backgroundColor.trim());
    }
    if (isPostgresHomeCanvasHexColor(nextDraft.gridColor)) {
      document.documentElement.style.setProperty("--canvas-grid-color", nextDraft.gridColor.trim());
    }
    applyCanvasSettings(nextDraft.gridEnabled, nextDraft.gridDensity);
  }

  function openHomeCanvasAppearanceModal() {
    const draft = readPostgresHomeCanvasAppearanceDraft();
    setHomeCanvasAppearanceDraft(draft);
    setHomeCanvasAppearanceError("");
  }

  function updateHomeCanvasAppearanceDraft(patch: Partial<PostgresHomeCanvasAppearanceDraft>) {
    setHomeCanvasAppearanceDraft((current) => {
      const nextDraft = { ...(current ?? readPostgresHomeCanvasAppearanceDraft()), ...patch };
      applyHomeCanvasAppearanceDraft(nextDraft);
      return nextDraft;
    });
    setHomeCanvasAppearanceError("");
  }

  async function closeHomeCanvasAppearanceModal() {
    if (!homeCanvasAppearanceDraft) {
      setHomeCanvasAppearanceDraft(null);
      return;
    }
    if (
      !isPostgresHomeCanvasHexColor(homeCanvasAppearanceDraft.backgroundColor)
      || !isPostgresHomeCanvasHexColor(homeCanvasAppearanceDraft.gridColor)
    ) {
    setHomeCanvasAppearanceError(t("projectCore.homeShell.validHexColorsRequired"));
      return;
    }

    setHomeCanvasAppearanceSaving(true);
    try {
      const theme = getStoredTheme();
      const defaults = getAppDefaults(theme);
      const overrides = { ...getStoredOverrides(theme) };
      const nextBackgroundColor = homeCanvasAppearanceDraft.backgroundColor.trim().toLowerCase();
      const nextGridColor = homeCanvasAppearanceDraft.gridColor.trim().toLowerCase();

      if (nextBackgroundColor === defaults["--canvas-background"].toLowerCase()) {
        delete overrides["--canvas-background"];
      } else {
        overrides["--canvas-background"] = nextBackgroundColor;
      }
      if (nextGridColor === defaults["--canvas-grid-color"].toLowerCase()) {
        delete overrides["--canvas-grid-color"];
      } else {
        overrides["--canvas-grid-color"] = nextGridColor;
      }

      saveOverrides(theme, overrides);
      applyHomeCanvasAppearanceDraft({
        ...homeCanvasAppearanceDraft,
        backgroundColor: nextBackgroundColor,
        gridColor: nextGridColor,
      });
      const preferences = await getPostgresUserPreferences();
      await savePostgresUserPreferences({
        ...preferences,
        themeState: getStoredThemeState(),
      });
      setHomeCanvasAppearanceDraft(null);
      setHomeCanvasAppearanceError("");
    } catch (error) {
      setHomeCanvasAppearanceError(error instanceof Error ? error.message : String(error));
    } finally {
      setHomeCanvasAppearanceSaving(false);
    }
  }

  function resetHomeCanvasAppearanceDraft() {
    const theme = getStoredTheme();
    const defaults = getAppDefaults(theme);
    const nextDraft = {
      backgroundColor: defaults["--canvas-background"],
      gridColor: defaults["--canvas-grid-color"],
      gridEnabled: DEFAULT_CANVAS_GRID_ENABLED,
      gridDensity: DEFAULT_CANVAS_GRID_DENSITY,
    };
    setHomeCanvasAppearanceDraft(nextDraft);
    setHomeCanvasAppearanceError("");
    applyHomeCanvasAppearanceDraft(nextDraft);
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
      setPostgresAnnotationNavigationTargetId(menu.id);
      setActiveScreen("annotations");
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
    if (homeCanvasDeleteTarget.kind === "annotation") return;
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
          notes: string;
          extractedText: string;
          shapeOverride: string;
          colorOverride: string;
          outlineColorOverride: string;
          fillOverride: string;
          fillTransparencyOverride: number | null;
          outlineWidthOverride: number | null;
          imageStoragePath: string;
          pendingImageFile: File | null;
          removeImage: boolean;
          attributeValuesByDefinitionId: Record<string, string>;
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
        const createdUploadItems: Array<{ source: PostgresSource; draft: typeof payload.items[number] }> = [];
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
            notes: item.notes,
            shapeOverride: item.shapeOverride || null,
            colorOverride: item.colorOverride || null,
            outlineColorOverride: item.outlineColorOverride || null,
            fillOverride: item.fillOverride || null,
            fillTransparencyOverride: item.fillTransparencyOverride,
            outlineWidthOverride: item.outlineWidthOverride,
            imageStoragePath: item.imageStoragePath || null,
          });
          let createdWithImage = created;
          if (item.pendingImageFile) {
            const imageBytes = new Uint8Array(await item.pendingImageFile.arrayBuffer());
            createdWithImage = await importPostgresSourceImage({
              projectId: project.id,
              sourceId: created.id,
              originalFileName: item.pendingImageFile.name,
              fileBytesBase64: bytesToBase64(imageBytes),
            });
          }
          createdSources.push(createdWithImage);
          createdUploadItems.push({ source: createdWithImage, draft: item });
        }
        for (const definition of sourceAttributeDefinitions) {
          const nextCreatedValues = createdUploadItems
            .map(({ source, draft }) => ({
              sourceId: source.id,
              value: draft.attributeValuesByDefinitionId[definition.id] ?? "",
            }))
            .filter((value) => value.value);
          if (nextCreatedValues.length === 0) continue;
          await savePostgresSourceAttribute({
            projectId: project.id,
            attributeDefinitionId: definition.id,
            name: definition.name,
            dataType: definition.dataType,
            description: definition.description,
            options: definition.options,
            sourceKinds: definition.sourceKinds,
            values: sources
              .map((source) => ({
                sourceId: source.id,
                value: sourceAttributeValues.find((value) =>
                  value.sourceId === source.id && value.attributeDefinitionId === definition.id
                )?.value ?? "",
              }))
              .concat(nextCreatedValues),
          });
        }
      }

      if (createdSources.length > 0) {
        setSources((current) => [...current, ...createdSources]);
      }
      if (pendingTimelineCreateStart) {
        await applyTimelineStartToCreatedSources(createdSources, pendingTimelineCreateStart);
      }
      setCreateSourceOpen(false);
      setPendingTimelineCreateStart("");
      if (
        gettingStartedState.step === "addTextSource"
        && !gettingStartedState.dismissed
        && !gettingStartedState.completed
        && createdSources.length > 0
      ) {
        const createdSource = createdSources[0];
        await persistGettingStartedState({
          sourceId: createdSource.id,
          step: "openCodingView",
        });
      }
    } catch (saveError) {
      setGraphError(saveError instanceof Error ? saveError.message : "Failed to save source.");
    } finally {
      setGraphSubmitting(false);
    }
  }

  async function handleUpdateHomeCanvasSource(payload: SourceEditorPayload) {
    if (!editingHomeCanvasSource) return;
    setGraphSubmitting(true);
    setGraphError("");
    setGraphNotice("");
    try {
      if (payload.removeImage) {
        await removePostgresSourceImage(project.id, editingHomeCanvasSource.id);
      }
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
        shapeOverride: payload.shapeOverride,
        colorOverride: payload.colorOverride,
        outlineColorOverride: payload.outlineColorOverride,
        fillOverride: payload.fillOverride,
        fillTransparencyOverride: payload.fillTransparencyOverride,
        outlineWidthOverride: payload.outlineWidthOverride,
        imageStoragePath: payload.pendingImageFile ? editingHomeCanvasSource.imageStoragePath || null : payload.imageStoragePath,
      });
      let savedWithImage = saved;
      if (payload.pendingImageFile) {
        const imageBytes = new Uint8Array(await payload.pendingImageFile.arrayBuffer());
        savedWithImage = await importPostgresSourceImage({
          projectId: project.id,
          sourceId: saved.id,
          originalFileName: payload.pendingImageFile.name,
          fileBytesBase64: bytesToBase64(imageBytes),
        });
      }

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

      setSources((current) => current.map((entry) => (entry.id === savedWithImage.id ? savedWithImage : entry)));
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
      if (
        gettingStartedState.step === "createCode"
        && !gettingStartedState.dismissed
        && !gettingStartedState.completed
      ) {
        await persistGettingStartedState({
          codeId: created.id,
          step: "assignCode",
        });
      }
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
    setPendingTimelineCreateStart("");
  }

  function closeCreateObjectModal() {
    setPendingCanvasNodePosition(null);
    setPendingTimelineCreateStart("");
    setDraftObjectPendingImage(null);
    setObjectImageStoragePath("");
    setObjectFillTransparencyOverride(null);
    setObjectOutlineWidthOverride(null);
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

  function getRelationshipTypeMatrixRows(relationshipTypeId: string | null) {
    return (relationshipTypeId
      ? relationships.filter((relationship) => relationship.relationshipTypeId === relationshipTypeId)
      : [])
      .map((relationship) => ({
        id: relationship.id,
        name: relationship.description
          || `${relationship.fromEntityName || relationship.fromObjectId} -> ${relationship.toEntityName || relationship.toObjectId}`,
      }))
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
  }

  function getRelationshipObjectRestrictionItems(): PostgresRelationshipEndpointRestrictionItem[] {
    return objectTypes.map((objectType) => ({
      id: objectType.id,
      label: objectType.name,
      color: normalizePostgresObjectTypeColor(objectType.color),
      outlineColor: normalizeOptionalPostgresObjectTypeColor(objectType.outlineColor) || normalizePostgresObjectTypeColor(objectType.color),
      shape: normalizePostgresObjectTypeShape(objectType.shape),
      fill: normalizePostgresObjectFill(objectType.fill),
      imageStoragePath: objectType.imageStoragePath ?? "",
    }));
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
      .map(([id, count]) => ({ id, label: formatPostgresSourceKindLabel(id, t), count }))
      .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" }));
  }, [sources, t]);
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
    ...POSTGRES_SOURCE_KIND_OPTIONS.map((option) => {
      const setting = sourceTypeSettings.find((entry) =>
        normalizePostgresSourceKind(entry.sourceKind) === normalizePostgresSourceKind(option.id)
      );
      return {
        id: `__home_canvas_source:${option.sourceVisualKey}`,
        projectId: project.id,
        systemKey: option.sourceVisualKey,
        name: setting?.name || formatPostgresSourceKindLabel(option.id, t),
        description: setting?.description || "",
        shape: setting ? normalizePostgresObjectTypeShape(setting.shape) : "rectangle",
        color: setting ? normalizePostgresObjectTypeColor(setting.color || option.color) : option.color,
        outlineColor: setting
          ? normalizeOptionalPostgresObjectTypeColor(setting.outlineColor) || normalizePostgresObjectTypeColor(setting.color || option.color)
          : option.color,
        fill: setting ? normalizePostgresObjectFill(setting.fill) : "outline",
        fillTransparency: setting ? normalizePostgresObjectFillTransparency(setting.fillTransparency) : POSTGRES_OBJECT_TYPE_DEFAULT_FILL_TRANSPARENCY,
        outlineWidth: setting ? normalizePostgresObjectOutlineWidth(setting.outlineWidth) : POSTGRES_OBJECT_TYPE_DEFAULT_OUTLINE_WIDTH,
        imageStoragePath: setting?.imageStoragePath ?? "",
        createdAt: setting?.createdAt || project.createdAt,
        updatedAt: setting?.updatedAt || project.updatedAt,
      };
    }),
    {
      id: "__home_canvas_source",
      projectId: project.id,
      systemKey: "home_canvas_source",
      name: t("projectCore.entities.source"),
      description: "",
      shape: "rectangle",
      color: "#2f6f73",
      outlineColor: "#2f6f73",
      fill: "outline",
      fillTransparency: POSTGRES_OBJECT_TYPE_DEFAULT_FILL_TRANSPARENCY,
      outlineWidth: POSTGRES_OBJECT_TYPE_DEFAULT_OUTLINE_WIDTH,
      imageStoragePath: "",
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
    {
      id: "__home_canvas_code",
      projectId: project.id,
      systemKey: "home_canvas_code",
      name: t("projectCore.entities.code"),
      description: "",
      shape: "tag",
      color: "#8a5a44",
      outlineColor: "#8a5a44",
      fill: "outline",
      fillTransparency: POSTGRES_OBJECT_TYPE_DEFAULT_FILL_TRANSPARENCY,
      outlineWidth: POSTGRES_OBJECT_TYPE_DEFAULT_OUTLINE_WIDTH,
      imageStoragePath: "",
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
  ], [project.createdAt, project.id, project.updatedAt, sourceTypeSettings, t]);
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
          objectType: formatPostgresSourceKindLabel(source.sourceKind, t),
          objectTypeSystemKey: getPostgresSourceKindOption(source.sourceKind)?.sourceVisualKey ?? "home_canvas_source",
          title: source.title || source.originalFileName || "Untitled source",
          description: source.notes || "",
          shapeOverride: source.shapeOverride ?? "",
          colorOverride: source.colorOverride ?? "",
          outlineColorOverride: source.outlineColorOverride ?? "",
          fillOverride: source.fillOverride ?? "",
          fillTransparencyOverride: source.fillTransparencyOverride ?? null,
          outlineWidthOverride: source.outlineWidthOverride ?? null,
          imageStoragePath: source.imageStoragePath ?? "",
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
          objectType: t("projectCore.entities.code"),
          objectTypeSystemKey: "home_canvas_code",
          title: code.label || "Untitled code",
          description: code.description || "",
          shapeOverride: "",
          colorOverride: code.color || "",
          outlineColorOverride: code.color || "",
          fillOverride: "",
          fillTransparencyOverride: null,
          outlineWidthOverride: null,
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
  }, [codes, homeCanvasSectionEnabled, objects, sources, t, visibleHomeCanvasCodeIds, visibleHomeCanvasObjectTypeIds, visibleHomeCanvasSourceKinds]);
  const drawCanvasObjects = useMemo<PostgresObject[]>(() => [
    ...objects,
    ...sources.map((source) => ({
      id: source.id,
      projectId: source.projectId,
      objectTypeId: getHomeCanvasSourceObjectTypeId(source.sourceKind),
      objectType: formatPostgresSourceKindLabel(source.sourceKind, t),
      objectTypeSystemKey: getPostgresSourceKindOption(source.sourceKind)?.sourceVisualKey ?? "home_canvas_source",
      title: source.title || source.originalFileName || "Untitled source",
      description: source.notes || "",
      shapeOverride: source.shapeOverride ?? "",
      colorOverride: source.colorOverride ?? "",
      outlineColorOverride: source.outlineColorOverride ?? "",
      fillOverride: source.fillOverride ?? "",
      fillTransparencyOverride: source.fillTransparencyOverride ?? null,
      outlineWidthOverride: source.outlineWidthOverride ?? null,
      imageStoragePath: source.imageStoragePath ?? "",
      eventStartAt: null,
      eventEndAt: null,
      eventTimePrecision: null,
      eventTimezone: null,
      eventIsInstant: null,
      attributeValues: [],
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
    })),
    ...codes.map((code) => ({
      id: code.id,
      projectId: code.projectId,
      objectTypeId: "__home_canvas_code",
      objectType: t("projectCore.entities.code"),
      objectTypeSystemKey: "home_canvas_code",
      title: code.label || "Untitled code",
      description: code.description || "",
      shapeOverride: "",
      colorOverride: code.color || "",
      outlineColorOverride: code.color || "",
      fillOverride: "",
      fillTransparencyOverride: null,
      outlineWidthOverride: null,
      imageStoragePath: "",
      eventStartAt: null,
      eventEndAt: null,
      eventTimePrecision: null,
      eventTimezone: null,
      eventIsInstant: null,
      attributeValues: [],
      createdAt: code.createdAt,
      updatedAt: code.updatedAt,
    })),
  ], [codes, objects, sources, t]);
  const canvasObjectImageStoragePaths = useMemo(
    () => Array.from(new Set([
      ...objects.map((object) => object.imageStoragePath ?? ""),
      ...sources.map((source) => source.imageStoragePath ?? ""),
      ...objectTypes.map((objectType) => objectType.imageStoragePath ?? ""),
      ...homeCanvasVirtualObjectTypes.map((objectType) => objectType.imageStoragePath ?? ""),
    ].map((path) => path.trim()).filter(Boolean))).sort(),
    [homeCanvasVirtualObjectTypes, objectTypes, objects, sources],
  );
  const canvasObjectImageUrlByStoragePath = usePostgresStoredImageUrlMap(project.storagePath, canvasObjectImageStoragePaths);
  const getCanvasPostgresObjectAppearance = useCallback((
    object: Parameters<typeof getPostgresObjectAppearance>[0],
    objectTypeRecord: Parameters<typeof getPostgresObjectAppearance>[1],
  ) => {
    const appearance = getPostgresObjectAppearance(object, objectTypeRecord);
    const uploadedImageUrl = appearance.imageStoragePath
      ? canvasObjectImageUrlByStoragePath.get(appearance.imageStoragePath) ?? ""
      : "";
    return {
      ...appearance,
      sourceImage: uploadedImageUrl || appearance.sourceImage,
    };
  }, [canvasObjectImageUrlByStoragePath]);
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
        const appearance = getCanvasPostgresObjectAppearance(object, objectTypeRecord);
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
  }, [getCanvasPostgresObjectAppearance, homeCanvasObjects, homeCanvasVirtualObjectTypes, objectTypes]);
  const getHomeCanvasNodeGroupSizePercent = useCallback((nodeIds: string[]) => {
    if (nodeIds.length === 0) return 100;
    const homeObjectById = new Map(homeCanvasObjects.map((object) => [object.id, object]));
    const homeObjectTypeById = new Map([...objectTypes, ...homeCanvasVirtualObjectTypes].map((objectType) => [objectType.id, objectType]));
    const percents = nodeIds.flatMap((nodeId) => {
      const object = homeObjectById.get(nodeId);
      const node = canvasNodes[nodeId];
      if (!object || !node) return [];
      const objectTypeRecord = homeObjectTypeById.get(object.objectTypeId) ?? null;
      const appearance = getCanvasPostgresObjectAppearance(object, objectTypeRecord);
      const defaultDimensions = appearance.sourceImage
        ? getSourceCanvasNodeDefaultDimensions()
        : getCanvasNodeDefaultDimensions(appearance.shape);
      if (defaultDimensions.width <= 0) return [];
      return Math.round((node.width / defaultDimensions.width) * 100);
    });
    if (percents.length === 0) return 100;
    const average = Math.round(percents.reduce((total, percent) => total + percent, 0) / percents.length);
    return Math.max(10, Math.min(300, Math.round(average / 5) * 5));
  }, [canvasNodes, getCanvasPostgresObjectAppearance, homeCanvasObjects, homeCanvasVirtualObjectTypes, objectTypes]);
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
  const drawCanvasRelationships = useMemo<PostgresRelationship[]>(() => {
    const nextRelationships: PostgresRelationship[] = [
      ...relationships.map((relationship) => ({
        ...relationship,
        fromObjectId: relationship.fromEntityType === "source" ? relationship.fromEntityId : relationship.fromObjectId,
        toObjectId: relationship.toEntityType === "source" ? relationship.toEntityId : relationship.toObjectId,
      })),
    ];
    annotationSummaries.forEach((annotation) => {
      const source = sources.find((entry) => entry.id === annotation.sourceId);
      annotation.codeIds.forEach((codeId) => {
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
    return nextRelationships;
  }, [annotationSummaries, codes, relationships, sources]);
  const buildFreshDrawCanvasNodes = useCallback(() => {
    const objectTypeById = new Map([...objectTypes, ...homeCanvasVirtualObjectTypes].map((objectType) => [objectType.id, objectType]));
    const next: Record<string, PostgresCanvasNodeState> = {};
    drawCanvasObjects.forEach((object, index) => {
      const objectTypeRecord = objectTypeById.get(object.objectTypeId) ?? null;
      const appearance = getCanvasPostgresObjectAppearance(object, objectTypeRecord);
      const defaultDimensions = appearance.sourceImage
        ? getSourceCanvasNodeDefaultDimensions()
        : getCanvasNodeDefaultDimensions(appearance.shape);
      const column = index % 4;
      const row = Math.floor(index / 4);
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
    return next;
  }, [drawCanvasObjects, getCanvasPostgresObjectAppearance, homeCanvasVirtualObjectTypes, objectTypes]);
  const startFreshDrawCanvasSession = useCallback(() => {
    setDrawCanvasNodes(buildFreshDrawCanvasNodes());
    setDrawCanvasShapes([]);
    setDrawCanvasHiddenRelationshipIds([]);
    setDrawCanvasStateLoaded(true);
    setDrawSavedDrawingId(null);
    setDrawSavedDrawingName("");
    setDrawCanvasSaveNotice("");
    setCanvasSaveError("");
    setDrawCanvasAutoLayoutKey((current) => current + 1);
    setProjectHomeGraphFitKey((current) => current + 1);
    setActiveScreen("analysis-draw-canvas");
  }, [buildFreshDrawCanvasNodes]);
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

    const canvasObjectsForContext = activeScreen === "analysis-draw-canvas" ? drawCanvasObjects : homeCanvasObjects;
    const canvasObject = canvasObjectsForContext.find((object) => object.id === rawId);
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
  }, [activeScreen, drawCanvasObjects, homeCanvasObjects]);
  const handleHomeTimelineItemContextMenu = useCallback((context: {
    kind: "source" | "object" | "relationship";
    id: string;
    groupId: string;
    clientX: number;
    clientY: number;
  }) => {
    setHomeCanvasContextMenu({
      kind: context.kind,
      id: context.id,
      x: Math.min(context.clientX, window.innerWidth - 190),
      y: Math.min(context.clientY, window.innerHeight - 170),
      canvasPosition: null,
      timelineGroupId: context.groupId,
    });
    setHomeCanvasCreateMenuOpen(false);
  }, []);
  const handleSaveTimelineGroup = useCallback(async (draft: {
    groupId?: string | null;
    name: string;
    description: string;
    icon: string;
    color: string;
    outlineColor: string;
    backgroundColor: string;
    itemFill: string;
    itemFillTransparency: number;
    backgroundFill: string;
    itemTextColor: string;
    textSize: string;
  }) => {
    const savedGroup = await savePostgresTimelineGroup({
      projectId: project.id,
      groupId: draft.groupId,
      name: draft.name,
      description: draft.description,
      icon: draft.icon,
      color: draft.color,
      outlineColor: draft.outlineColor,
      backgroundColor: draft.backgroundColor,
      itemFill: draft.itemFill,
      itemFillTransparency: draft.itemFillTransparency,
      backgroundFill: draft.backgroundFill,
      itemTextColor: draft.itemTextColor,
      textSize: draft.textSize,
    });
    setTimelineGroups((current) => {
      const withoutGroup = current.filter((group) => group.id !== savedGroup.id);
      return [...withoutGroup, savedGroup].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
    });
    return savedGroup;
  }, [project.id]);
  const handleDeleteTimelineGroup = useCallback(async (groupId: string) => {
    await deletePostgresTimelineGroup(project.id, groupId);
    setTimelineGroups((current) => current.filter((group) => group.id !== groupId));
    setTimelineItemGroupAssignments((current) => current.filter((assignment) => assignment.groupId !== groupId));
  }, [project.id]);
  const handleReorderTimelineGroups = useCallback(async (groupIds: string[]) => {
    if (groupIds.length === 0) return;
    setTimelineGroups((current) => {
      const orderById = new Map(groupIds.map((groupId, index) => [groupId, index]));
      return current
        .map((group) => orderById.has(group.id) ? { ...group, sortOrder: orderById.get(group.id) ?? group.sortOrder } : group)
        .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
    });
    const savedGroups = await reorderPostgresTimelineGroups(project.id, groupIds);
    setTimelineGroups(savedGroups);
  }, [project.id]);
  const handleReorderTimelineGroupRows = useCallback(async (groupKeys: string[]) => {
    if (groupKeys.length === 0) return;
    setTimelineGroupRowOrders(groupKeys.map((groupKey, index) => ({
      groupKey,
      sortOrder: index,
      updatedAt: new Date().toISOString(),
    })));
    const savedRowOrders = await reorderPostgresTimelineGroupRows(project.id, groupKeys);
    setTimelineGroupRowOrders(savedRowOrders);
  }, [project.id]);
  const handleSetTimelineItemGroup = useCallback(async (request: {
    itemKind: "source" | "object" | "relationship";
    itemId: string;
    groupId: string | null;
  }) => {
    await setPostgresTimelineItemGroup({
      projectId: project.id,
      itemKind: request.itemKind,
      itemId: request.itemId,
      groupId: request.groupId,
    });
    setTimelineItemGroupAssignments((current) => {
      const withoutItem = current.filter((assignment) => !(assignment.itemKind === request.itemKind && assignment.itemId === request.itemId));
      if (!request.groupId) return withoutItem;
      return [
        ...withoutItem,
        {
          itemKind: request.itemKind,
          itemId: request.itemId,
          groupId: request.groupId,
          updatedAt: new Date().toISOString(),
        },
      ];
    });
  }, [project.id]);
  const handleRemoveHomeTimelineItemFromGroup = useCallback(async (menu: PostgresHomeCanvasContextMenuState) => {
    if (
      !canManageSources
      || !menu.id
      || !menu.timelineGroupId?.startsWith("group:")
      || (menu.kind !== "source" && menu.kind !== "object" && menu.kind !== "relationship")
    ) {
      return;
    }
    closeHomeCanvasContextMenu();
    await handleSetTimelineItemGroup({
      itemKind: menu.kind,
      itemId: menu.id,
      groupId: null,
    });
  }, [canManageSources, closeHomeCanvasContextMenu, handleSetTimelineItemGroup]);
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
  const gettingStartedGuideActive =
    !gettingStartedState.dismissed
    && !gettingStartedState.completed;
  const guideSpotlightItemId =
    gettingStartedGuideActive
    && (gettingStartedState.step === "projectHomeIntro" || gettingStartedState.step === "addTextSource")
      ? "sources"
      : gettingStartedGuideActive && gettingStartedState.step === "openCodingView"
        ? "code-text"
        : null;
  const guideDetailsTourActive =
    gettingStartedGuideActive && gettingStartedState.step === "projectHomeDetailsIntro";
  const guideModesTourActive =
    gettingStartedGuideActive && gettingStartedState.step === "projectHomeModesIntro";
  const guideCollapsedSidebarTourActive =
    gettingStartedGuideActive && gettingStartedState.step === "projectHomeSidebarCollapsedIntro";
  const guideExpandedSidebarTourActive =
    gettingStartedGuideActive && gettingStartedState.step === "projectHomeSidebarExpandedIntro";
  const guideForceSidebarExpanded =
    gettingStartedGuideActive
    && (
      gettingStartedState.step === "projectHomeSidebarExpandedIntro"
      || gettingStartedState.step === "projectHomeIntro"
      || gettingStartedState.step === "addTextSource"
      || gettingStartedState.step === "openCodingView"
    );

  function handleShowProjectSources() {
    if (
      gettingStartedGuideActive
      && gettingStartedState.step === "projectHomeIntro"
    ) {
      void persistGettingStartedState({ step: "addTextSource" });
    }
    setActiveScreen("sources");
  }

  function handleShowProjectCodeText() {
    setActiveScreen("code-text");
  }

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
          nextTimelineGroups,
          nextTimelineGroupRowOrders,
          nextTimelineItemGroupAssignments,
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
          listPostgresTimelineGroups(project.id),
          listPostgresTimelineGroupRowOrders(project.id),
          listPostgresTimelineItemGroupAssignments(project.id),
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
          setTimelineGroups(nextTimelineGroups);
          setTimelineGroupRowOrders(nextTimelineGroupRowOrders);
          setTimelineItemGroupAssignments(nextTimelineItemGroupAssignments);
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
          setTimelineGroups([]);
          setTimelineGroupRowOrders([]);
          setTimelineItemGroupAssignments([]);
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
        if (drawing.canvasKind === "graph_draw") {
          setDrawCanvasNodes(Object.fromEntries(drawing.state.nodes.map((node) => [node.id, node])));
          setDrawCanvasShapes(drawing.state.shapes);
          setDrawCanvasHiddenRelationshipIds(drawing.state.hiddenRelationshipIds ?? []);
          setDrawCanvasStateLoaded(true);
          setDrawSavedDrawingId(drawing.id);
          setDrawSavedDrawingName(drawing.name);
          setDrawCanvasSaveNotice("");
          setCanvasSaveError("");
          setDrawCanvasAutoLayoutKey(0);
          setProjectHomeGraphFitKey((current) => current + 1);
          setActiveScreen("analysis-draw-canvas");
          return;
        }
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
          ${renderSvgObjectShape(appearance.shape, nodeWidth, nodeHeight, appearance.color, appearance.outlineColor, appearance.fill, appearance.sourceVisualKey, appearance.fillTransparency, appearance.outlineWidth)}
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
        nextImage.onerror = () => reject(new Error(t("projectCore.homeShell.renderSavedCanvasImageFailed")));
        nextImage.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(width);
      canvas.height = Math.ceil(height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error(t("projectCore.homeShell.createExportCanvasContextFailed"));
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
        else reject(new Error(t("projectCore.homeShell.encodeSavedCanvasPngFailed")));
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
          throw new Error(t("projectCore.homeShell.prepareSavedCanvasSvgPdfFailed"));
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
        nextTimelineGroups,
        nextTimelineGroupRowOrders,
        nextTimelineItemGroupAssignments,
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
        listPostgresTimelineGroups(project.id),
        listPostgresTimelineGroupRowOrders(project.id),
        listPostgresTimelineItemGroupAssignments(project.id),
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
      setTimelineGroups(nextTimelineGroups);
      setTimelineGroupRowOrders(nextTimelineGroupRowOrders);
      setTimelineItemGroupAssignments(nextTimelineItemGroupAssignments);
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
      setTimelineGroups([]);
      setTimelineGroupRowOrders([]);
      setTimelineItemGroupAssignments([]);
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
      const canvasSourceObjects = activeScreen === "explore" ? objects : homeCanvasObjects;
      const canvasSourceObjectTypes = activeScreen === "explore" ? objectTypes : [...objectTypes, ...homeCanvasVirtualObjectTypes];
      const objectTypeById = new Map(canvasSourceObjectTypes.map((objectType) => [objectType.id, objectType]));
      const next: Record<string, PostgresCanvasNodeState> = {};
      canvasSourceObjects.forEach((object, index) => {
        const existing = current[object.id];
        const objectTypeRecord = objectTypeById.get(object.objectTypeId) ?? null;
        const appearance = getCanvasPostgresObjectAppearance(object, objectTypeRecord);
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
  }, [activeScreen, getCanvasPostgresObjectAppearance, homeCanvasObjects, homeCanvasVirtualObjectTypes, objectTypes, objects]);

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
      setRelationshipAttributeEditorError(t("projectCore.homeShell.chooseRelationshipTypeFirst"));
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
              fillTransparencyOverride: object.fillTransparencyOverride ?? null,
              outlineWidthOverride: object.outlineWidthOverride ?? null,
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
      setGraphError(t("projectCore.homeShell.objectTypeAndTitleRequired"));
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
        fillTransparencyOverride: objectGraphicMode === "select" && resolvePostgresObjectFill({ fillOverride: objectFillOverride }, selectedCreateObjectType) === "filled" && objectFillTransparencyOverride !== null
          ? normalizePostgresObjectFillTransparency(objectFillTransparencyOverride)
          : null,
        outlineWidthOverride: objectGraphicMode === "select" && objectOutlineWidthOverride !== null
          ? normalizePostgresObjectOutlineWidth(objectOutlineWidthOverride)
          : null,
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
      setObjectFillTransparencyOverride(null);
      setObjectOutlineWidthOverride(null);
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
      setGraphError(t("projectCore.homeShell.objectTypeNameRequired"));
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
      setDraftObjectTypeFillTransparency(POSTGRES_OBJECT_TYPE_DEFAULT_FILL_TRANSPARENCY);
      setDraftObjectTypeOutlineWidth(POSTGRES_OBJECT_TYPE_DEFAULT_OUTLINE_WIDTH);
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
        fillTransparency: draftObjectTypeFill === "filled" ? normalizePostgresObjectFillTransparency(draftObjectTypeFillTransparency) : POSTGRES_OBJECT_TYPE_DEFAULT_FILL_TRANSPARENCY,
        outlineWidth: normalizePostgresObjectOutlineWidth(draftObjectTypeOutlineWidth),
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
      setDraftObjectTypeFillTransparency(POSTGRES_OBJECT_TYPE_DEFAULT_FILL_TRANSPARENCY);
      setDraftObjectTypeOutlineWidth(POSTGRES_OBJECT_TYPE_DEFAULT_OUTLINE_WIDTH);
      setDraftObjectTypeImageStoragePath("");
      setDraftObjectTypePendingImage(null);
      setDraftObjectTypeGraphicMode("select");
      initializeObjectTypeAttributeEditor(null);
      setObjectTypeModalTab("details");
      setCreateObjectTypeOpen(false);
      setSelectedObjectTypeFilter(savedObjectType.id);
      setObjectTypeId(savedObjectType.id);
      if (createObjectOpen && pendingTimelineCreateStart) {
        const timelineStartDefinition = saved.attributeDefinitions.find((definition) =>
          definition.timelineRole === "timeline_start" && definition.dataType === "datetime"
        );
        if (timelineStartDefinition) {
          setObjectAttributeValues((current) => ({ ...current, [timelineStartDefinition.id]: pendingTimelineCreateStart }));
        }
      } else if (!createObjectOpen) {
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
        {
          loadFailed: t("sharedModals.imageCrop.loadFailed"),
          prepareFailed: t("sharedModals.imageCrop.prepareFailed"),
        },
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
      setFillTransparencyOverride: Dispatch<SetStateAction<number | null>>;
      setOutlineWidthOverride: Dispatch<SetStateAction<number | null>>;
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
      config.setFillTransparencyOverride(null);
      config.setOutlineWidthOverride(null);
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
      config.setFillTransparencyOverride(null);
      config.setOutlineWidthOverride(null);
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
      setGraphError(t("projectCore.homeShell.objectTypeNameRequired"));
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
        fillTransparency: draftObjectTypeFill === "filled" ? normalizePostgresObjectFillTransparency(draftObjectTypeFillTransparency) : POSTGRES_OBJECT_TYPE_DEFAULT_FILL_TRANSPARENCY,
        outlineWidth: normalizePostgresObjectOutlineWidth(draftObjectTypeOutlineWidth),
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
              fillTransparencyOverride: object.fillTransparencyOverride ?? null,
              outlineWidthOverride: object.outlineWidthOverride ?? null,
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
      setDraftObjectTypeFillTransparency(POSTGRES_OBJECT_TYPE_DEFAULT_FILL_TRANSPARENCY);
      setDraftObjectTypeOutlineWidth(POSTGRES_OBJECT_TYPE_DEFAULT_OUTLINE_WIDTH);
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
      setGraphError(t("projectCore.homeShell.objectTypeAndTitleRequired"));
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
        fillTransparencyOverride: editingObjectGraphicMode === "select" && resolvePostgresObjectFill({ fillOverride: editingObjectFillOverride }, selectedEditObjectType) === "filled" && editingObjectFillTransparencyOverride !== null
          ? normalizePostgresObjectFillTransparency(editingObjectFillTransparencyOverride)
          : null,
        outlineWidthOverride: editingObjectGraphicMode === "select" && editingObjectOutlineWidthOverride !== null
          ? normalizePostgresObjectOutlineWidth(editingObjectOutlineWidthOverride)
          : null,
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
      setGraphError(t("projectCore.homeShell.relationshipTypeNameRequired"));
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
      if (createRelationshipOpen && pendingTimelineCreateStart) {
        const timelineStartDefinition = saved.attributeDefinitions.find((definition) =>
          definition.timelineRole === "timeline_start" && definition.dataType === "datetime"
        );
        setRelationshipAttributeValues(timelineStartDefinition ? { [timelineStartDefinition.id]: pendingTimelineCreateStart } : {});
      } else {
        setRelationshipAttributeValues({});
      }
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
      setGraphError(t("projectCore.homeShell.relationshipTypeNameRequired"));
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
      setGraphError(t("projectCore.homeShell.relationshipEndpointsRequired"));
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
      setGraphError(t("projectCore.homeShell.relationshipEndpointsRequired"));
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

  const renderAnalysisDrawCanvas = () => (
    <Suspense fallback={<ViewLoadingFallback />}>
      <PostgresAnalysisDrawCanvasViewLazy onBack={() => setActiveScreen("analysis-draw")}>
        <div className="postgres-experiment-home-canvas-column">
          <PostgresProjectHomeGraphViewLazy
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
            canvasStateLoaded={drawCanvasStateLoaded}
            loadingFallback={<ViewLoadingFallback />}
            canManageSources={canManageSources}
            canManageAnnotations={canManageAnnotations}
            onCreateSource={openCreateSourceModal}
            onCreateObject={openCreateObjectModal}
            onCreateRelationship={() => openCreateRelationshipModal()}
            onCreateCode={openCreateCodeModal}
            objectTypes={objectTypes}
            homeCanvasVirtualObjectTypes={homeCanvasVirtualObjectTypes}
            homeCanvasObjects={drawCanvasObjects}
            homeCanvasRelationships={drawCanvasRelationships}
            homeCanvasRelationshipTypes={homeCanvasRelationshipTypes}
            canvasNodes={drawCanvasNodes}
            setCanvasNodes={setDrawCanvasNodes}
            canvasShapes={drawCanvasShapes}
            setCanvasShapes={setDrawCanvasShapes}
            hiddenCanvasRelationshipIds={drawCanvasHiddenRelationshipIds}
            getObjectAppearance={getCanvasPostgresObjectAppearance}
            getObjectSurfaceStyle={getPostgresObjectSurfaceStyle}
            getRelationshipAppearance={getPostgresRelationshipAppearance}
            getRelationshipStrokeWidth={getPostgresRelationshipStrokeWidth}
            getNodeDefaultDimensions={(object, objectTypeRecord) => {
              const appearance = getCanvasPostgresObjectAppearance(object, objectTypeRecord);
              return appearance.sourceImage
                ? getSourceCanvasNodeDefaultDimensions()
                : getCanvasNodeDefaultDimensions(appearance.shape);
            }}
            getNodeRenderedDimensions={(object, objectTypeRecord, nodeState) => {
              const appearance = getCanvasPostgresObjectAppearance(object, objectTypeRecord);
              return appearance.sourceImage
                ? getSourceCanvasNodeRenderedDimensions(nodeState)
                : getCanvasNodeRenderedDimensions(appearance.shape, nodeState);
            }}
            getInspectorDetails={(selection) => {
              if (selection.kind === "relationship") {
                if (selection.relationship.id.startsWith("annotation:")) {
                  const annotationId = selection.relationship.id.split(":")[1] ?? "";
                  const annotation = annotationSummaries.find((entry) => entry.id === annotationId);
                  const source = annotation ? sources.find((entry) => entry.id === annotation.sourceId) : null;
                  const codeLabel =
                    selection.relationship.toEntityName.trim() ||
                    annotation?.primaryCodeLabel?.trim() ||
                    "";
                  const previewText = truncatePostgresHomeAnnotationPreview(
                    annotation?.quote || annotation?.note || selection.relationship.description || "",
                  );

                  return {
                    title: annotation ? t("projectCore.graph.annotationTitle", { id: `A${String(annotation.displayId).padStart(2, "0")}` }) : t("projectCore.graph.annotation"),
                    itemType: t("projectCore.entities.annotation"),
                    typeDetail: codeLabel ? t("projectCore.graph.codeDetail", { code: codeLabel }) : "",
                    preview:
                      annotation?.imageRegion && source?.storagePath ? (
                        <PostgresHomeAnnotationImagePreview
                          projectStoragePath={project.storagePath}
                          sourceStoragePath={source.storagePath}
                          sourceKind={annotation.sourceKind || source.sourceKind}
                          imageRegion={annotation.imageRegion}
                        />
                      ) : previewText ? (
                        <div className="postgres-explore-inspector-preview">
                          <p className="postgres-explore-inspector-text">{previewText}</p>
                        </div>
                      ) : null,
                    attributes: [],
                  };
                }

                return {
                  title: selection.relationship.relationshipType.trim() || t("projectCore.graph.relationship"),
                  itemType: t("projectCore.entities.relationship"),
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
                  title: selection.object.title.trim() || t("projectCore.graph.untitledSource"),
                  itemType: t("projectCore.entities.source"),
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
                  parentLabels.unshift(parentCode.label || t("projectCore.graph.untitledCode"));
                  parentCodeId = parentCode.parentCodeId;
                }
                return {
                  title: selection.object.title.trim() || t("projectCore.graph.untitledCode"),
                  itemType: t("projectCore.entities.code"),
                  typeDetail: parentLabels.length > 0 ? parentLabels.join(" > ") : t("projectCore.graph.topLevelCode"),
                  attributes: [],
                };
              }

              return {
                title: selection.object.title.trim() || t("projectCore.graph.untitledObject"),
                itemType: t("projectCore.entities.object"),
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
            autoLayoutOnVisibleKey={drawCanvasAutoLayoutKey}
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
            onOpenDrawTool={() => undefined}
            drawCanvasToolbar={(
              <div className="postgres-analysis-draw-canvas-toolbar">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={openSaveGraphDrawModal}
                  disabled={drawCanvasSaving}
                >
                  {drawCanvasSaving ? t("projectCore.sources.saving") : t("projectCore.sources.save")}
                </button>
                {drawSavedDrawingName ? (
                  <span className="home-restricted-value">{drawSavedDrawingName}</span>
                ) : (
                  <span className="home-restricted-value">{t("projectCore.homeShell.savedCanvases.unsavedDrawing")}</span>
                )}
                {drawCanvasSaveNotice ? <span className="settings-success">{drawCanvasSaveNotice}</span> : null}
                {canvasSaveError ? <span className="auth-error">{canvasSaveError}</span> : null}
              </div>
            )}
          />
        </div>
      </PostgresAnalysisDrawCanvasViewLazy>
    </Suspense>
  );

  return (
    <div className="app-shell">
      <PostgresSidebar
        activeScreen={activeScreen}
        activeProject={project}
        authSession={authSession}
        networkMode={sidebarNetworkMode}
        aiStatus={aiAssistAllowed ? sidebarAiStatus : "disabled"}
        aiAssistAllowed={aiAssistAllowed}
        collaborationStatus={sidebarCollaborationStatus}
        guideSpotlightItemId={guideSpotlightItemId}
        guideSpotlightSidebar={guideCollapsedSidebarTourActive || guideExpandedSidebarTourActive}
        forceExpanded={guideForceSidebarExpanded}
        lockExpandedNavigation={guideExpandedSidebarTourActive}
        onShowProjects={onBack}
        onShowProjectHome={() => setActiveScreen("home")}
        onShowProjectUsers={() => setActiveScreen("users")}
        onShowProjectSources={handleShowProjectSources}
        onShowProjectAnnotations={() => setActiveScreen("annotations")}
        onShowProjectCodebook={() => setActiveScreen("codebook")}
        onShowProjectCodeText={handleShowProjectCodeText}
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
                  <h1>{project.name || t("projectCore.home.untitledProject")}</h1>
                  <button
                    type="button"
                    className="users-help-icon-btn"
                    onClick={() => setProjectHelpModal("home")}
                    title={t("projectCore.home.openHelp")}
                    aria-label={t("projectCore.home.openHelp")}
                  >
                    <HelpIcon className="users-help-icon" />
                  </button>
                </div>
              </header>
              <div
                className={`ai-assist-home-tabbar${guideModesTourActive ? " getting-started-spotlight-target" : ""}`}
                style={{ marginBottom: 18 }}
              >
                <div className="segmented-control" role="tablist" aria-label={t("projectCore.home.viewTabsAria")}>
                  {([
                    ["details", t("projectCore.home.tabs.details")],
                    ["graph", t("projectCore.home.tabs.graph")],
                    ["timeline", t("projectCore.home.tabs.timeline")],
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
              {guideDetailsTourActive ? (
                <>
                  <div className="getting-started-spotlight-overlay" aria-hidden="true" />
                  <GettingStartedGuideCallout
                    title={t("app.gettingStarted.projectSummaryTitle")}
                    onDismiss={() => void persistGettingStartedState({ dismissed: true })}
                    actions={(
                      <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => void persistGettingStartedState({ step: "projectHomeModesIntro" })}
                      >
                        {t("app.gettingStarted.next")}
                      </button>
                    )}
                  >
                    <p>{t("app.gettingStarted.projectSummaryBody")}</p>
                  </GettingStartedGuideCallout>
                </>
              ) : null}
              {guideModesTourActive ? (
                <>
                  <div className="getting-started-spotlight-overlay" aria-hidden="true" />
                  <GettingStartedGuideCallout
                    title={t("app.gettingStarted.projectModesTitle")}
                    onDismiss={() => void persistGettingStartedState({ dismissed: true })}
                    actions={(
                      <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => void persistGettingStartedState({ step: "projectHomeSidebarCollapsedIntro" })}
                      >
                        {t("app.gettingStarted.next")}
                      </button>
                    )}
                  >
                  <p>{t("app.gettingStarted.projectModesBody")}</p>
                </GettingStartedGuideCallout>
                </>
              ) : null}
              {guideCollapsedSidebarTourActive ? (
                <>
                  <div className="getting-started-spotlight-overlay" aria-hidden="true" />
                  <GettingStartedGuideCallout
                    title={t("app.gettingStarted.sidebarCollapsedTitle")}
                    onDismiss={() => void persistGettingStartedState({ dismissed: true })}
                    actions={(
                      <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => void persistGettingStartedState({ step: "projectHomeSidebarExpandedIntro" })}
                      >
                        {t("app.gettingStarted.next")}
                      </button>
                    )}
                  >
                    <p>{t("app.gettingStarted.sidebarCollapsedBody")}</p>
                  </GettingStartedGuideCallout>
                </>
              ) : null}
              {guideExpandedSidebarTourActive ? (
                <>
                  <div className="getting-started-spotlight-overlay" aria-hidden="true" />
                  <GettingStartedGuideCallout
                    title={t("app.gettingStarted.sidebarExpandedTitle")}
                    onDismiss={() => void persistGettingStartedState({ dismissed: true })}
                    actions={(
                      <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => void persistGettingStartedState({ step: "projectHomeIntro" })}
                      >
                        {t("app.gettingStarted.next")}
                      </button>
                    )}
                  >
                    <p>{t("app.gettingStarted.sidebarExpandedBody")}</p>
                  </GettingStartedGuideCallout>
                </>
              ) : null}
              {gettingStartedState.step === "projectHomeIntro" && !gettingStartedState.dismissed && !gettingStartedState.completed ? (
                <>
                  <div className="getting-started-spotlight-overlay" aria-hidden="true" />
                <GettingStartedGuideCallout
                  title={t("app.gettingStarted.openSourcesTitle")}
                  onDismiss={() => void persistGettingStartedState({ dismissed: true })}
                >
                  <p>{t("app.gettingStarted.openSourcesBody")}</p>
                </GettingStartedGuideCallout>
                </>
              ) : null}
              {gettingStartedState.step === "addTextSource" && !gettingStartedState.dismissed && !gettingStartedState.completed ? (
                <>
                  <div className="getting-started-spotlight-overlay" aria-hidden="true" />
                  <GettingStartedGuideCallout title={t("app.gettingStarted.openSourcesTitle")} onDismiss={() => void persistGettingStartedState({ dismissed: true })}>
                    <p>{t("app.gettingStarted.addTextSourceFromHomeBody")}</p>
                  </GettingStartedGuideCallout>
                </>
              ) : null}
              {gettingStartedState.step === "openCodingView" && !gettingStartedState.dismissed && !gettingStartedState.completed ? (
                <>
                  <div className="getting-started-spotlight-overlay" aria-hidden="true" />
                  <GettingStartedGuideCallout title={t("app.gettingStarted.openCodingTitle")} onDismiss={() => void persistGettingStartedState({ dismissed: true })}>
                    <p>{t("app.gettingStarted.openCodingFromHomeBody")}</p>
                  </GettingStartedGuideCallout>
                </>
              ) : null}
              {projectHomeTab === "details" ? (
                <div className={guideDetailsTourActive ? "getting-started-spotlight-target" : undefined}>
                  <Suspense fallback={<ViewLoadingFallback />}>
                    <PostgresProjectHomeDetailsViewLazy
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
                  </Suspense>
                </div>
              ) : projectHomeTab === "timeline" ? (
                <div className="project-home-timeline-tab">
                  <Suspense fallback={<ViewLoadingFallback />}>
                  <PostgresProjectHomeTimelineViewLazy
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
                    timelineGroups={timelineGroups}
                    timelineGroupRowOrders={timelineGroupRowOrders}
                    timelineItemGroupAssignments={timelineItemGroupAssignments}
                    canManageSources={canManageSources}
                    canManageAnnotations={canManageAnnotations}
                    onCreateSource={(timelineStart) => openCreateSourceModal(timelineStart)}
                    onCreateObject={(timelineStart) => openCreateObjectModal(undefined, undefined, timelineStart)}
                    onCreateRelationship={(timelineStart) => openCreateRelationshipModal({ timelineStart })}
                    onCreateCode={openCreateCodeModal}
                    onTimelineItemContextMenu={handleHomeTimelineItemContextMenu}
                    onSaveTimelineGroup={handleSaveTimelineGroup}
                    onDeleteTimelineGroup={handleDeleteTimelineGroup}
                    onReorderTimelineGroups={handleReorderTimelineGroups}
                    onReorderTimelineGroupRows={handleReorderTimelineGroupRows}
                    onSetTimelineItemGroup={handleSetTimelineItemGroup}
                  />
                  </Suspense>
                </div>
              ) : (
                <Suspense fallback={<ViewLoadingFallback />}>
                <PostgresProjectHomeGraphViewLazy
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
                  getObjectAppearance={getCanvasPostgresObjectAppearance}
                  getObjectSurfaceStyle={getPostgresObjectSurfaceStyle}
                  getRelationshipAppearance={getPostgresRelationshipAppearance}
                  getRelationshipStrokeWidth={getPostgresRelationshipStrokeWidth}
                  getNodeDefaultDimensions={(object, objectTypeRecord) => {
                    const appearance = getCanvasPostgresObjectAppearance(object, objectTypeRecord);
                    return appearance.sourceImage
                      ? getSourceCanvasNodeDefaultDimensions()
                      : getCanvasNodeDefaultDimensions(appearance.shape);
                  }}
                  getNodeRenderedDimensions={(object, objectTypeRecord, nodeState) => {
                    const appearance = getCanvasPostgresObjectAppearance(object, objectTypeRecord);
                    return appearance.sourceImage
                      ? getSourceCanvasNodeRenderedDimensions(nodeState)
                      : getCanvasNodeRenderedDimensions(appearance.shape, nodeState);
                  }}
                  getInspectorDetails={(selection) => {
                    if (selection.kind === "relationship") {
                      if (selection.relationship.id.startsWith("annotation:")) {
                        const annotationId = selection.relationship.id.split(":")[1] ?? "";
                        const annotation = annotationSummaries.find((entry) => entry.id === annotationId);
                        const source = annotation ? sources.find((entry) => entry.id === annotation.sourceId) : null;
                        const codeLabel =
                          selection.relationship.toEntityName.trim() ||
                          annotation?.primaryCodeLabel?.trim() ||
                          "";
                        const previewText = truncatePostgresHomeAnnotationPreview(
                          annotation?.quote || annotation?.note || selection.relationship.description || "",
                        );

                        return {
                          title: annotation ? t("projectCore.graph.annotationTitle", { id: `A${String(annotation.displayId).padStart(2, "0")}` }) : t("projectCore.graph.annotation"),
                          itemType: t("projectCore.entities.annotation"),
                          typeDetail: codeLabel ? t("projectCore.graph.codeDetail", { code: codeLabel }) : "",
                          preview:
                            annotation?.imageRegion && source?.storagePath ? (
                              <PostgresHomeAnnotationImagePreview
                                projectStoragePath={project.storagePath}
                                sourceStoragePath={source.storagePath}
                                sourceKind={annotation.sourceKind || source.sourceKind}
                                imageRegion={annotation.imageRegion}
                              />
                            ) : previewText ? (
                              <div className="postgres-explore-inspector-preview">
                                <p className="postgres-explore-inspector-text">{previewText}</p>
                              </div>
                            ) : null,
                          attributes: [],
                        };
                      }

                      return {
                        title: selection.relationship.relationshipType.trim() || t("projectCore.graph.relationship"),
                        itemType: t("projectCore.entities.relationship"),
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
                        title: selection.object.title.trim() || t("projectCore.graph.untitledSource"),
                        itemType: t("projectCore.entities.source"),
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
                        parentLabels.unshift(parentCode.label || t("projectCore.graph.untitledCode"));
                        parentCodeId = parentCode.parentCodeId;
                      }
                      return {
                        title: selection.object.title.trim() || t("projectCore.graph.untitledCode"),
                        itemType: t("projectCore.entities.code"),
                        typeDetail: parentLabels.length > 0 ? parentLabels.join(" > ") : t("projectCore.graph.topLevelCode"),
                        attributes: [],
                      };
                    }

                    return {
                      title: selection.object.title.trim() || t("projectCore.graph.untitledObject"),
                      itemType: t("projectCore.entities.object"),
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
                </Suspense>
              )}
            </div>
          ) : activeScreen === "users" ? (
            <>
              <div className="view users-view postgres-users-view">
                <header className="view-header">
                  <div className="users-title-wrap">
                    <h1>{t("projectCore.homeShell.usersTitle")}</h1>
                    <button
                      type="button"
                      className="users-help-icon-btn"
                      onClick={() => setProjectHelpModal("users")}
                      title={t("projectCore.homeShell.openUsersHelp")}
                      aria-label={t("projectCore.homeShell.openUsersHelp")}
                    >
                      <HelpIcon className="users-help-icon" />
                    </button>
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
                            <h2 style={{ margin: 0, fontSize: 18 }}>{t("projectCore.homeShell.userRoles")}</h2>
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
                                  {t("projectCore.homeShell.role")}
                                  <span className="users-sort-icon">
                                    {userRoleSortCol === "role" ? (userRoleSortDir === "asc" ? " ?" : " ?") : " ?"}
                                  </span>
                                </th>
                                <th
                                  className={`users-th${userRoleSortCol === "count" ? " users-th--sorted" : ""}`}
                                  style={{ width: "24%" }}
                                  onClick={() => handleUserRoleSort("count")}
                                >
                                  {t("projectCore.homeShell.count")}
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
                                  {t("projectCore.homeShell.allUsers")}
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
                          <p>{t("projectCore.homeShell.loadingUsers")}</p>
                        </div>
                      ) : users.length === 0 ? (
                        <div className="empty-state postgres-users-empty-state">
                          <p>{t("projectCore.homeShell.noUsers")}</p>
                        </div>
                      ) : filteredProjectUsers.length === 0 ? (
                        <div className="empty-state postgres-users-empty-state">
                          <p>{t("projectCore.homeShell.noUsersMatchRole")}</p>
                        </div>
                      ) : (
                        <div className="users-table-wrap postgres-users-table-wrap" style={{ maxHeight: 520 }}>
                          <table className="users-table">
                            <thead>
                              <tr>
                                <th className="users-th" style={{ width: "28%" }}>{t("projectCore.homeShell.user")}</th>
                                <th className="users-th" style={{ width: "18%" }}>{t("projectCore.homeShell.role")}</th>
                                <th className="users-th" style={{ width: "27%" }}>{t("projectCore.entities.created")}</th>
                                <th className="users-th" style={{ width: "27%" }}>{t("projectCore.homeShell.lastActive")}</th>
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
                gettingStartedState={gettingStartedState}
                onGettingStartedStateChange={persistGettingStartedState}
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
                gettingStartedState={gettingStartedState}
                onGettingStartedStateChange={persistGettingStartedState}
                onInitialNavigationHandled={() => setPostgresSourceNavigationTarget(null)}
                onOpenPostgresMemoDraft={(payload) => {
                  setPostgresMemoDraftTarget(payload);
                  setActiveScreen("memos");
                }}
              />
            </Suspense>
          ) : activeScreen === "analysis-draw" ? (
            <Suspense fallback={<ViewLoadingFallback />}>
              <PostgresAnalysisDrawViewLazy
                drawings={savedDrawings.filter((drawing) => drawing.canvasKind === "graph_draw")}
                onCreateDrawing={startFreshDrawCanvasSession}
                onOpenDrawing={(drawingId: string) => {
                  void openSavedDrawingSession(drawingId, "edit");
                }}
              />
            </Suspense>
          ) : activeScreen === "analysis-draw-canvas" ? (
            renderAnalysisDrawCanvas()
          ) : activeScreen === "analysis-network" ? (
            <Suspense fallback={<ViewLoadingFallback />}>
              <PostgresAnalysisNetworkViewLazy />
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
              title={t("projectCore.homeShell.objectAttributes")}
              detail={t("projectCore.homeShell.objectAttributesPortDescription")}
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
                      {t("projectCore.homeShell.objects.back")}
                    </button>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => openEditObjectModal(selectedObjectDetails)}
                      >
                        {t("projectCore.homeShell.objects.editObject")}
                      </button>
                      <button
                        type="button"
                        className="btn btn--danger"
                        onClick={() => setRemovingObjectId(selectedObjectDetails.id)}
                      >
                        {t("projectCore.homeShell.objects.deleteObject")}
                      </button>
                    </div>
                  </div>

                  <div className="doc-detail-layout">
                    <div className="doc-detail-left">
                      <div className="case-card">
                        <h3 className="case-card-title">{t("projectCore.homeShell.objects.graphics")}</h3>
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
                            {selectedObjectDetails.objectType || t("projectCore.entities.object")}
                          </p>
                        </div>
                        <dl className="user-detail-meta case-detail-meta">
                          <dt>{t("projectCore.homeShell.objects.color")}</dt>
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
                              {selectedObjectDetails.colorOverride?.trim() || t("projectCore.homeShell.objects.inherited")}
                            </span>
                          </dd>
                          <dt>{t("projectCore.homeShell.objects.outline")}</dt>
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
                              {selectedObjectDetails.outlineColorOverride?.trim() || t("projectCore.homeShell.objects.inherited")}
                            </span>
                          </dd>
                          <dt>{t("projectCore.homeShell.objects.shape")}</dt>
                          <dd>
                            {selectedObjectDetails.shapeOverride?.trim()
                              ? formatPostgresObjectShapeLabel(resolvePostgresObjectShape(selectedObjectDetails, selectedObjectDetailsType))
                              : t("projectCore.homeShell.objects.inherited")}
                          </dd>
                          <dt>{t("projectCore.homeShell.objects.fill")}</dt>
                          <dd>
                            {selectedObjectDetails.fillOverride?.trim()
                              ? formatPostgresObjectFillLabel(resolvePostgresObjectFill(selectedObjectDetails, selectedObjectDetailsType))
                              : t("projectCore.homeShell.objects.inherited")}
                          </dd>
                        </dl>
                      </div>

                      <div className="case-card">
                        <h3 className="case-card-title">{t("projectCore.homeShell.objects.attributes")}</h3>
                        {selectedObjectDetailsAttributeDefinitions.length > 0 ? (
                          <div className="case-detail-attributes-table-wrap">
                            <table className="case-detail-attributes-table">
                              <thead>
                                <tr>
                                  <th className="case-detail-attributes-label" scope="col">{t("projectCore.homeShell.objects.attribute")}</th>
                                  <th className="case-detail-attributes-value" scope="col">{t("projectCore.homeShell.objects.value")}</th>
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
                                            ownerName: selectedObjectDetails.title || t("projectCore.homeShell.objects.untitledObject"),
                                            attributeDefinitionId: definition.id,
                                            attributeName: definition.name,
                                          })}
                                          title={t("projectCore.homeShell.objects.viewAttributeHistory")}
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
                          <p className="case-card-empty">{t("projectCore.homeShell.objects.noSharedAttributes")}</p>
                        )}
                      </div>
                    </div>

                    <div className="doc-detail-right doc-detail-right--annotation">
                      <div className="case-card">
                        <h3 className="case-card-title">{t("projectCore.homeShell.objects.details")}</h3>
                        <p className="case-card-value">{selectedObjectDetails.title || t("projectCore.homeShell.objects.untitledObject")}</p>
                        <dl className="user-detail-meta case-detail-meta" style={{ marginTop: 16 }}>
                          <dt>{t("projectCore.homeShell.objects.objectType")}</dt> <dd>{selectedObjectDetails.objectType || "-"}</dd>
                          <dt>{t("projectCore.homeShell.objects.created")}</dt>
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
                          <dt>{t("projectCore.homeShell.objects.updated")}</dt>
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
                          <h3 className="case-card-title">{t("projectCore.homeShell.objects.description")}</h3>
                          {selectedObjectDetails.description.trim() ? (
                            <p style={{ margin: 0, lineHeight: 1.6, overflowWrap: "anywhere" }}>
                              {selectedObjectDetails.description}
                            </p>
                          ) : (
                            <p className="case-card-empty">{t("projectCore.homeShell.objects.noDescription")}</p>
                          )}
                        </div>
                      </div>

                      <div className="case-card" style={{ marginTop: 16 }}>
                        <h3 className="case-card-title">{t("projectCore.homeShell.objects.relationships")}</h3>
                        {selectedObjectRelationshipRows.length > 0 ? (
                          <div className="case-detail-attributes-table-wrap">
                            <table className="users-table" style={{ tableLayout: "fixed" }}>
                              <thead>
                                <tr>
                                  <th className="users-th" style={{ width: "42%" }}>{t("projectCore.homeShell.objects.otherObject")}</th>
                                  <th className="users-th" style={{ width: "24%" }}>{t("projectCore.homeShell.objects.objectType")}</th>
                                  <th className="users-th" style={{ width: "34%" }}>{t("projectCore.homeShell.objects.relationship")}</th>
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
                          <p className="case-card-empty">{t("projectCore.homeShell.objects.noRelationships")}</p>
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
                        title={t("projectCore.homeShell.objects.deleteObject")}
                        warning={t("projectCore.homeShell.objects.deleteWarning")}
                        busy={graphSubmitting}
                        confirmLabel={t("projectCore.homeShell.objects.deleteObject")}
                        busyLabel={t("projectCore.sources.deleting")}
                        onClose={() => setRemovingObjectId(null)}
                        onConfirm={() => void handleDeleteObject(object.id)}
                      >
                        <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                          {t("projectCore.homeShell.objects.deletePrompt", { name: object.title })}
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
                    <h1>{t("projectCore.homeShell.objects.title")}</h1>
                    <button
                      type="button"
                      className="users-help-icon-btn"
                      onClick={() => setProjectHelpModal("objects")}
                      title={t("projectCore.homeShell.objects.openHelp")}
                      aria-label={t("projectCore.homeShell.objects.openHelp")}
                    >
                      <HelpIcon className="users-help-icon" />
                    </button>
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
                          {t("projectCore.homeShell.objects.details")}
                        </button>
                        <button type="button" className="segmented-control-option" tabIndex={-1}>
                          {t("projectCore.homeShell.objects.attributes")}
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
                          <h2 style={{ margin: 0, fontSize: 18 }}>{t("projectCore.homeShell.objects.objectTypes")}</h2>
                          {!showObjectAttributesTable ? (
                            <button
                              type="button"
                              className="btn project-create-icon-button"
                              aria-label={t("projectCore.homeShell.objects.addObjectType")}
                              title={t("projectCore.homeShell.objects.addObjectType")}
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
                                {t("projectCore.homeShell.objects.typeColumn")}
                                <span className="users-sort-icon">
                                  {objectTypeSortCol === "objectType" ? (objectTypeSortDir === "asc" ? " ?" : " ?") : " ?"}
                                </span>
                              </th>
                              <th
                                className={`users-th${objectTypeSortCol === "count" ? " users-th--sorted" : ""}`}
                                style={{ width: "24%" }}
                                onClick={() => handleObjectTypeSort("count")}
                              >
                                {t("projectCore.homeShell.count")}
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
                                <span>{t("projectCore.homeShell.objects.allObjects")}</span>
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
                                  <div className="project-type-list-cell">
                                    <div className="project-type-list-icon" aria-hidden="true">
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
                                    </div>
                                    <div className="project-type-list-copy">
                                      <span className="project-type-list-title">
                                        {summary.objectType}
                                      </span>
                                      <span className="postgres-users-meta project-type-list-meta">
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
                            <p>{t("projectCore.homeShell.objects.noObjectTypes")}</p>
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
                              {t("projectCore.sources.detail.edit")}
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
                              {t("common.delete")}
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
                        <div className="segmented-control" role="tablist" aria-label={t("projectCore.homeShell.objects.workspaceViews")}>
                          <button
                            type="button"
                            className={showObjectAttributesTable ? "segmented-control-option" : "segmented-control-option segmented-control-option--active"}
                            role="tab"
                            aria-selected={!showObjectAttributesTable}
                            onClick={() => setShowObjectAttributesTable(false)}
                          >
                            {t("projectCore.homeShell.objects.details")}
                          </button>
                          <button
                            type="button"
                            className={showObjectAttributesTable ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                            role="tab"
                            aria-selected={showObjectAttributesTable}
                            onClick={() => setShowObjectAttributesTable(true)}
                          >
                            {t("projectCore.homeShell.objects.attributes")}
                          </button>
                        </div>
                      </div>
                    </div>
                    {graphLoading ? (
                      <div className="empty-state postgres-users-empty-state">
                        <p>{t("projectCore.homeShell.objects.loadingObjects")}</p>
                      </div>
                    ) : showObjectAttributesTable ? (
                      <>
                        {selectedObjectTypeFilter === "all" ? (
                          <div className="empty-state postgres-users-empty-state">
                            <p>{t("projectCore.homeShell.objects.selectTypeForAttributes")}</p>
                          </div>
                        ) : (
                          <div className="home-project-card project-table-card">
                            <div className="project-table-card-header">
                              <h2>{t("projectCore.homeShell.objects.attributes")}</h2>
                              <button
                                type="button"
                                className="btn btn--primary project-table-header-icon-button"
                                onClick={openObjectWorkspaceAttributeModal}
                                disabled={graphSubmitting || objectWorkspaceAttributeTypeOptions.length === 0}
                                title={t("projectCore.homeShell.objects.addAttribute")}
                                aria-label={t("projectCore.homeShell.objects.addAttribute")}
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
                                    {t("projectCore.entities.object")}
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
                                      title={canManageSources ? t("projectCore.sources.editValuesForAttribute") : t("projectCore.sources.cannotManageSources")}
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
                                            ownerName: row.name || t("projectCore.homeShell.objects.untitledObject"),
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
                                            title={t("projectCore.homeShell.objects.viewAttributeHistory")}
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
                          <h2>{t("projectCore.homeShell.objects.title")}</h2>
                          <button
                            type="button"
                            className="btn btn--primary project-table-header-icon-button"
                            aria-label={t("projectCore.homeShell.objects.newObject")}
                            title={t("projectCore.homeShell.objects.newObject")}
                            onClick={() => openCreateObjectModal()}
                          >
                            <PlusIcon className="project-table-header-icon" />
                          </button>
                        </div>
                      <div className="users-table-wrap postgres-users-table-wrap">
                        <table className="users-table">
                          <thead>
                            <tr>
                              <th className="users-th" style={{ width: "42%" }}>{t("projectCore.homeShell.objects.titleColumn")}</th>
                              <th className="users-th" style={{ width: "30%" }}>{t("projectCore.homeShell.objects.typeColumn")}</th>
                              <th className="users-th" style={{ width: "28%" }}>{t("projectCore.homeShell.objects.updated")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredObjects.length === 0 ? (
                              <tr>
                                <td colSpan={3} className="users-td-msg">
                                  {selectedObjectTypeFilter === "all"
                                    ? t("projectCore.homeShell.objects.noObjects")
                                    : t("projectCore.homeShell.objects.noObjectsForType", {
                                        type: objectTypeById.get(selectedObjectTypeFilter)?.name ?? t("projectCore.homeShell.objects.selectedTypeFallback"),
                                      })}
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
                                    onContextMenu={(event) => {
                                      event.preventDefault();
                                      setOpenObjectTypeActionsMenu(null);
                                      setOpenRelationshipTypeActionsMenu(null);
                                      setOpenRelationshipActionsMenu(null);
                                      setOpenSavedDrawingActionsMenu(null);
                                      setOpenObjectActionsMenu({
                                        id: object.id,
                                        left: Math.min(event.clientX, window.innerWidth - 168),
                                        top: Math.min(event.clientY, window.innerHeight - 96),
                                      });
                                    }}
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
                        {openObjectActionsMenu ? (
                          <div
                            role="menu"
                            style={{
                              position: "fixed",
                              left: openObjectActionsMenu.left,
                              top: openObjectActionsMenu.top,
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
                                const object = objectById.get(openObjectActionsMenu.id);
                                if (object) openEditObjectModal(object);
                                setOpenObjectActionsMenu(null);
                              }}
                            >
                              {t("projectCore.homeShell.objects.editObjectLower")}
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
                                setRemovingObjectId(openObjectActionsMenu.id);
                                setOpenObjectActionsMenu(null);
                              }}
                            >
                              {t("projectCore.homeShell.objects.deleteObjectLower")}
                            </button>
                          </div>
                        ) : null}
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
                        title={t("projectCore.homeShell.objects.deleteObjectType")}
                        warning={t("projectCore.homeShell.objects.objectTypeDeleteCascadeWarning", { count: affectedObjectCount })}
                        busy={graphSubmitting}
                        confirmLabel={t("projectCore.homeShell.objects.deleteObjectType")}
                        busyLabel={t("projectCore.sources.deleting")}
                        onClose={() => setRemovingObjectTypeId(null)}
                        onConfirm={() => void handleDeleteObjectType(objectTypeRecord.id)}
                      >
                          <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                            {t("projectCore.homeShell.objects.deletePrompt", { name: objectTypeRecord.name })}
                          </p>
                          <p className="users-guide-copy" style={{ marginTop: 10, marginBottom: 0 }}>
                            {t("projectCore.homeShell.objects.objectTypeDeleteWarning")}
                          </p>
                      </GraphConfirmModal>
                    );
                  })()
                ) : null}
                {editingObjectTypeModalId ? (
                  <PostgresObjectTypeModal
                    title={t("projectCore.homeShell.objects.editObjectType")}
                    ariaLabel={t("projectCore.homeShell.objects.editObjectTypeTabs")}
                    tab={objectTypeModalTab}
                    setTab={setObjectTypeModalTab}
                    submitLabel={t("projectCore.homeShell.objects.saveChanges")}
                    projectStoragePath={project.storagePath}
                    submitting={graphSubmitting}
                    imageUploadSubmitting={imageUploadSubmitting}
                    name={draftObjectTypeName}
                    description={draftObjectTypeDescription}
                    shape={draftObjectTypeShape}
                    color={draftObjectTypeColor}
                    outlineColor={draftObjectTypeOutlineColor}
                    fill={draftObjectTypeFill}
                    fillTransparency={draftObjectTypeFillTransparency}
                    outlineWidth={draftObjectTypeOutlineWidth}
                    imageStoragePath={draftObjectTypeImageStoragePath}
                    graphicMode={draftObjectTypeGraphicMode}
                    attributeDrafts={objectTypeAttributeDrafts}
                    attributeRows={objects
                      .filter((object) => object.objectTypeId === editingObjectTypeModalId)
                      .map((object) => ({ id: object.id, name: object.title || t("projectCore.homeShell.objects.untitledObject") }))
                      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }))}
                    attributeValues={objectTypeAttributeValuesByDraftId}
                    emptyRowsLabel={t("projectCore.homeShell.objects.noObjectsOfType")}
                    onClose={() => setEditingObjectTypeModalId(null)}
                    onSubmit={handleSaveObjectType}
                    setName={setDraftObjectTypeName}
                    setDescription={setDraftObjectTypeDescription}
                    setShape={setDraftObjectTypeShape}
                    setColor={setDraftObjectTypeColor}
                    setOutlineColor={setDraftObjectTypeOutlineColor}
                    setFill={setDraftObjectTypeFill}
                    setFillTransparency={setDraftObjectTypeFillTransparency}
                    setOutlineWidth={setDraftObjectTypeOutlineWidth}
                    onGraphicModeChange={handleSetObjectTypeGraphicMode}
                    onImportImage={() => editingObjectTypeModalId ? void handleImportObjectTypeImage(editingObjectTypeModalId) : undefined}
                    onRemoveImage={() => editingObjectTypeModalId ? void handleRemoveObjectTypeImage(editingObjectTypeModalId) : undefined}
                    onTimelineFieldChange={(role, value) => updateTimelineFieldDrafts(
                      role,
                      value,
                      setObjectTypeAttributeDrafts,
                      (draft) => {
                        setTypeAttributeModalError("");
                        setObjectTypeAttributeModalDraft(draft);
                      },
                    )}
                    onAddAttribute={openNewObjectTypeAttributeModal}
                    onEditAttribute={(localId) => {
                      const draft = objectTypeAttributeDrafts.find((entry) => entry.localId === localId);
                      if (draft) openEditObjectTypeAttributeModal(draft);
                    }}
                    onDeleteAttribute={deleteObjectTypeAttributeDraft}
                    onChangeValue={updateObjectTypeMatrixValue}
                  />
                ) : null}
                {objectWorkspaceAttributeDraft ? (
                  <TypeScopedAttributeModal
                    draft={objectWorkspaceAttributeDraft}
                    typeOptions={objectWorkspaceAttributeTypeOptions}
                    title={t("projectCore.homeShell.objects.createObjectAttribute")}
                    typeLabel={t("projectCore.entities.object")}
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
                    emptyStateLabel={t("projectCore.homeShell.objects.createObjectFirst")}
                  />
                ) : null}
                {removingObjectId ? (
                  (() => {
                    const object = objects.find((entry) => entry.id === removingObjectId);
                    if (!object) return null;
                    return (
                      <GraphConfirmModal
                        title={t("projectCore.homeShell.objects.deleteObjectLower")}
                        warning={t("projectCore.homeShell.objects.deleteWarning")}
                        busy={graphSubmitting}
                        confirmLabel={t("projectCore.homeShell.objects.deleteObjectLower")}
                        busyLabel={t("projectCore.sources.deleting")}
                        onClose={() => setRemovingObjectId(null)}
                        onConfirm={() => void handleDeleteObject(object.id)}
                      >
                        <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                          {t("projectCore.homeShell.objects.deletePrompt", { name: object.title })}
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
                        {t("projectCore.homeShell.objects.back")}
                      </button>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => openEditRelationshipModal(selectedRelationshipDetails)}
                        >
                          {t("projectCore.homeShell.relationships.editRelationship")}
                        </button>
                        <button
                          type="button"
                          className="btn btn--danger"
                          onClick={() => setRemovingRelationshipId(selectedRelationshipDetails.id)}
                        >
                          {t("projectCore.homeShell.relationships.deleteRelationship")}
                        </button>
                      </div>
                    </div>

                    <div className="doc-detail-layout">
                      <div className="doc-detail-left">
                        <div className="case-card">
                          <h3 className="case-card-title">{t("projectCore.homeShell.relationships.appearance")}</h3>
                          {selectedRelationshipDetailsAppearance ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
                              <RelationshipTypeLinePreview
                                lineShape={selectedRelationshipDetailsAppearance.lineShape}
                                lineWeight={selectedRelationshipDetailsAppearance.lineWeight}
                                arrowhead={selectedRelationshipDetailsAppearance.arrowhead}
                                color={selectedRelationshipDetailsAppearance.color}
                              />
                              <p className="case-card-value" style={{ margin: 0 }}>
                                {selectedRelationshipDetails.relationshipType || t("projectCore.entities.relationship")}
                              </p>
                            </div>
                          ) : null}
                        </div>

                        <div className="case-card">
                          <h3 className="case-card-title">{t("projectCore.homeShell.relationships.attributes")}</h3>
                          {selectedRelationshipDetailsAttributeDefinitions.length > 0 ? (
                            <div className="case-detail-attributes-table-wrap">
                              <table className="case-detail-attributes-table">
                                <thead>
                                  <tr>
                                    <th className="case-detail-attributes-label" scope="col">{t("projectCore.homeShell.relationships.attribute")}</th>
                                    <th className="case-detail-attributes-value" scope="col">{t("projectCore.homeShell.relationships.value")}</th>
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
                                              ownerName: selectedRelationshipDetails.relationshipType || t("projectCore.entities.relationship"),
                                              attributeDefinitionId: definition.id,
                                              attributeName: definition.name,
                                            })}
                                            title={t("projectCore.homeShell.relationships.viewAttributeHistory")}
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
                            <p className="case-card-empty">{t("projectCore.homeShell.relationships.noSharedAttributes")}</p>
                          )}
                        </div>
                      </div>

                      <div className="doc-detail-right doc-detail-right--annotation">
                        <div className="case-card">
                          <h3 className="case-card-title">{t("projectCore.homeShell.relationships.details")}</h3>
                          <p className="case-card-value">{selectedRelationshipDetails.relationshipType || t("projectCore.entities.relationship")}</p>
                          <dl className="user-detail-meta case-detail-meta" style={{ marginTop: 16 }}>
                            <dt>{t("projectCore.homeShell.relationships.from")}</dt>
                            <dd>{fromObject ? `${fromObject.title} (${fromObject.objectType})` : selectedRelationshipDetails.fromEntityName || selectedRelationshipDetails.fromObjectId}</dd>
                            <dt>{t("projectCore.homeShell.relationships.to")}</dt>
                            <dd>{toObject ? `${toObject.title} (${toObject.objectType})` : selectedRelationshipDetails.toEntityName || selectedRelationshipDetails.toObjectId}</dd>
                            <dt>{t("projectCore.homeShell.relationships.relationshipType")}</dt>
                            <dd>{selectedRelationshipDetailsType?.name ?? selectedRelationshipDetails.relationshipType ?? "-"}</dd>
                            <dt>{t("projectCore.homeShell.relationships.created")}</dt>
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
                            <dt>{t("projectCore.homeShell.relationships.updated")}</dt>
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
                            <h3 className="case-card-title">{t("projectCore.homeShell.relationships.description")}</h3>
                            {selectedRelationshipDetails.description.trim() ? (
                              <p style={{ margin: 0, lineHeight: 1.6, overflowWrap: "anywhere" }}>
                                {selectedRelationshipDetails.description}
                              </p>
                            ) : (
                              <p className="case-card-empty">{t("projectCore.homeShell.relationships.noDescription")}</p>
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
                    <h1>{t("projectCore.homeShell.relationships.title")}</h1>
                    <button
                      type="button"
                      className="users-help-icon-btn"
                      onClick={() => setProjectHelpModal("relationships")}
                      title={t("projectCore.homeShell.relationships.openHelp")}
                      aria-label={t("projectCore.homeShell.relationships.openHelp")}
                    >
                      <HelpIcon className="users-help-icon" />
                    </button>
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
                          {t("projectCore.homeShell.relationships.details")}
                        </button>
                        <button type="button" className="segmented-control-option" tabIndex={-1}>
                          {t("projectCore.homeShell.relationships.attributes")}
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
                          <h2 style={{ margin: 0, fontSize: 18 }}>{t("projectCore.homeShell.relationships.relationshipTypes")}</h2>
                          {!showRelationshipAttributesTable ? (
                            <button
                              type="button"
                              className="btn project-create-icon-button"
                              aria-label={t("projectCore.homeShell.relationships.addRelationshipType")}
                              title={t("projectCore.homeShell.relationships.addRelationshipType")}
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
                                {t("projectCore.homeShell.relationships.typeColumn")}
                                <span className="users-sort-icon">
                                  {relationshipTypeSortCol === "relationshipType" ? (relationshipTypeSortDir === "asc" ? " ?" : " ?") : " ?"}
                                </span>
                              </th>
                              <th
                                className={`users-th${relationshipTypeSortCol === "count" ? " users-th--sorted" : ""}`}
                                style={{ width: "24%" }}
                                onClick={() => handleRelationshipTypeSort("count")}
                              >
                                {t("projectCore.homeShell.count")}
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
                                <span>{t("projectCore.homeShell.relationships.allRelationships")}</span>
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
                                  <div className="project-type-list-cell project-type-list-cell--relationship">
                                    <div className="project-type-list-icon" aria-hidden="true">
                                      <RelationshipTypeLinePreview
                                        lineShape={summary.lineShape}
                                        lineWeight={summary.lineWeight}
                                        arrowhead={summary.arrowhead}
                                        color={summary.color}
                                      />
                                    </div>
                                    <div className="project-type-list-copy">
                                      <span className="project-type-list-title">
                                        {summary.relationshipType}
                                      </span>
                                      <span className="postgres-users-meta project-type-list-meta">
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
                              {t("projectCore.sources.detail.edit")}
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
                              {t("common.delete")}
                            </button>
                          </div>
                        ) : null}
                        {relationshipTypeSummaries.length === 0 ? (
                          <div className="empty-state" style={{ minHeight: 140 }}>
                            <p>{t("projectCore.homeShell.relationships.noRelationshipTypes")}</p>
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
                        <div className="segmented-control" role="tablist" aria-label={t("projectCore.homeShell.relationships.workspaceViews")}>
                          <button
                            type="button"
                            className={showRelationshipAttributesTable ? "segmented-control-option" : "segmented-control-option segmented-control-option--active"}
                            role="tab"
                            aria-selected={!showRelationshipAttributesTable}
                            onClick={() => setShowRelationshipAttributesTable(false)}
                          >
                            {t("projectCore.homeShell.relationships.details")}
                          </button>
                          <button
                            type="button"
                            className={showRelationshipAttributesTable ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                            role="tab"
                            aria-selected={showRelationshipAttributesTable}
                            onClick={() => setShowRelationshipAttributesTable(true)}
                          >
                            {t("projectCore.homeShell.relationships.attributes")}
                          </button>
                        </div>
                      </div>
                    </div>

                    {graphLoading ? (
                      <div className="empty-state postgres-users-empty-state">
                        <p>{t("projectCore.homeShell.relationships.loadingRelationships")}</p>
                      </div>
                    ) : showRelationshipAttributesTable ? (
                      <>
                        {selectedRelationshipTypeFilter === "all" ? (
                          <div className="empty-state postgres-users-empty-state">
                            <p>{t("projectCore.homeShell.relationships.selectTypeForAttributes")}</p>
                          </div>
                        ) : relationshipAttributeDefinitionsForWorkspace.length === 0 ? (
                          <div className="empty-state postgres-users-empty-state">
                            <p>
                              {t("projectCore.homeShell.relationships.noAttributesForType", {
                                type: relationshipTypeById.get(selectedRelationshipTypeFilter)?.name ?? t("projectCore.homeShell.relationships.selectedRelationshipType"),
                              })}
                            </p>
                          </div>
                        ) : (
                          <div className="home-project-card project-table-card">
                            <div className="project-table-card-header">
                              <h2>{t("projectCore.homeShell.relationships.attributes")}</h2>
                              <button
                                type="button"
                                className="btn btn--primary project-table-header-icon-button"
                                onClick={openRelationshipWorkspaceAttributeModal}
                                disabled={graphSubmitting || relationshipWorkspaceAttributeTypeOptions.length === 0}
                                title={t("projectCore.homeShell.relationships.addAttribute")}
                                aria-label={t("projectCore.homeShell.relationships.addAttribute")}
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
                                    {t("projectCore.entities.relationship")}
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
                                      title={canManageSources ? t("projectCore.sources.editValuesForAttribute") : t("projectCore.homeShell.relationships.cannotEditAttributes")}
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
                                      {t("projectCore.homeShell.relationships.noRelationshipsForType", {
                                        type: relationshipTypeById.get(selectedRelationshipTypeFilter)?.name ?? t("projectCore.homeShell.relationships.selectedTypeFallback"),
                                      })}
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
                                            ownerName: row.name || t("projectCore.entities.relationship"),
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
                                            title={t("projectCore.homeShell.relationships.viewAttributeHistory")}
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
                          <h2>{t("projectCore.homeShell.relationships.title")}</h2>
                          <button
                            type="button"
                            className="btn btn--primary project-table-header-icon-button"
                            aria-label={t("projectCore.homeShell.relationships.newRelationship")}
                            title={t("projectCore.homeShell.relationships.newRelationship")}
                            onClick={() => openCreateRelationshipModal()}
                          >
                            <PlusIcon className="project-table-header-icon" />
                          </button>
                        </div>
                      <div className="users-table-wrap postgres-users-table-wrap">
                        <table className="users-table">
                          <thead>
                            <tr>
                              <th className="users-th" style={{ width: "28%" }}>{t("projectCore.homeShell.relationships.typeColumn")}</th>
                              <th className="users-th" style={{ width: "28%" }}>{t("projectCore.homeShell.relationships.from")}</th>
                              <th className="users-th" style={{ width: "28%" }}>{t("projectCore.homeShell.relationships.to")}</th>
                              <th className="users-th" style={{ width: "16%" }}>{t("projectCore.homeShell.relationships.updated")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredRelationships.length === 0 ? (
                              <tr>
                                <td colSpan={4} className="users-td-msg">
                                  {selectedRelationshipTypeFilter === "all"
                                    ? t("projectCore.homeShell.relationships.noRelationships")
                                    : t("projectCore.homeShell.relationships.noRelationshipsForType", {
                                        type: relationshipTypeById.get(selectedRelationshipTypeFilter)?.name ?? t("projectCore.homeShell.relationships.selectedTypeFallback"),
                                      })}
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
                                          {t("projectCore.sources.detail.edit")}
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
                                          {t("common.delete")}
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
                <PostgresRelationshipTypeModal
                  title={t("projectCore.homeShell.relationships.editRelationshipType")}
                  submitLabel={t("projectCore.homeShell.relationships.saveChanges")}
                  ariaLabel={t("projectCore.homeShell.relationships.editRelationshipTypeTabs")}
                  tab={relationshipTypeModalTab}
                  setTab={setRelationshipTypeModalTab}
                  projectStoragePath={project.storagePath}
                  submitting={graphSubmitting}
                  name={draftRelationshipTypeName}
                  lineShape={draftRelationshipLineShape}
                  lineWeight={draftRelationshipLineWeight}
                  arrowhead={draftRelationshipArrowhead}
                  color={draftRelationshipColor}
                  fromObjectTypeIds={draftRelationshipFromObjectTypeIds}
                  toObjectTypeIds={draftRelationshipToObjectTypeIds}
                  fromSourceKinds={draftRelationshipFromSourceKinds}
                  toSourceKinds={draftRelationshipToSourceKinds}
                  objectRestrictionItems={getRelationshipObjectRestrictionItems()}
                  sourceRestrictionItems={POSTGRES_SOURCE_KIND_OPTIONS}
                  attributeDrafts={relationshipTypeAttributeDrafts}
                  attributeRows={getRelationshipTypeMatrixRows(editingRelationshipTypeModalId)}
                  attributeValues={relationshipTypeAttributeValuesByDraftId}
                  emptyRowsLabel={t("projectCore.homeShell.relationships.noRelationshipsOfType")}
                  onClose={() => setEditingRelationshipTypeModalId(null)}
                  onSubmit={handleSaveRelationshipType}
                  setName={setDraftRelationshipTypeName}
                  setLineShape={setDraftRelationshipLineShape}
                  setLineWeight={setDraftRelationshipLineWeight}
                  setArrowhead={setDraftRelationshipArrowhead}
                  setColor={setDraftRelationshipColor}
                  setFromObjectTypeIds={setDraftRelationshipFromObjectTypeIds}
                  setToObjectTypeIds={setDraftRelationshipToObjectTypeIds}
                  setFromSourceKinds={setDraftRelationshipFromSourceKinds}
                  setToSourceKinds={setDraftRelationshipToSourceKinds}
                  onTimelineFieldChange={(role, value) => updateTimelineFieldDrafts(
                    role,
                    value,
                    setRelationshipTypeAttributeDrafts,
                    (draft) => {
                      setTypeAttributeModalError("");
                      setRelationshipTypeAttributeModalDraft(draft);
                    },
                  )}
                  onAddAttribute={openNewRelationshipTypeAttributeModal}
                  onEditAttribute={(localId) => {
                    const draft = relationshipTypeAttributeDrafts.find((entry) => entry.localId === localId);
                    if (draft) openEditRelationshipTypeAttributeModal(draft);
                  }}
                  onDeleteAttribute={deleteRelationshipTypeAttributeDraft}
                  onChangeValue={updateRelationshipTypeMatrixValue}
                />
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
                      title={t("projectCore.homeShell.relationships.deleteRelationshipType")}
                      warning={t("projectCore.homeShell.relationships.relationshipTypeDeleteWarning", { count: affectedRelationshipCount })}
                      busy={graphSubmitting}
                      confirmLabel={t("projectCore.homeShell.relationships.deleteRelationshipType")}
                      busyLabel={t("projectCore.sources.deleting")}
                      onClose={() => setRemovingRelationshipTypeId(null)}
                      onConfirm={() => void handleDeleteRelationshipType(relationshipTypeRecord.id)}
                    >
                        <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                          {t("projectCore.homeShell.relationships.deletePrompt", { name: relationshipTypeRecord.name })}
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
                      title={t("projectCore.homeShell.relationships.deleteRelationshipLower")}
                      warning={t("projectCore.homeShell.relationships.deleteRelationshipWarning")}
                      busy={graphSubmitting}
                      confirmLabel={t("projectCore.homeShell.relationships.deleteRelationshipLower")}
                      busyLabel={t("projectCore.sources.deleting")}
                      onClose={() => setRemovingRelationshipId(null)}
                      onConfirm={() => void handleDeleteRelationship(relationship.id)}
                    >
                        <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                          {t("projectCore.homeShell.relationships.deletePrompt", { name: relationship.relationshipType })}
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
                  emptyStateLabel={t("projectCore.homeShell.relationships.createRelationshipFirst")}
                />
              ) : null}
              {relationshipWorkspaceAttributeDraft ? (
                <TypeScopedAttributeModal
                  draft={relationshipWorkspaceAttributeDraft}
                  typeOptions={relationshipWorkspaceAttributeTypeOptions}
                  title={t("projectCore.homeShell.relationships.createRelationshipAttribute")}
                  typeLabel={t("projectCore.entities.relationship")}
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
                  emptyStateLabel={t("projectCore.homeShell.relationships.createRelationshipFirst")}
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
              <PostgresFreeDrawCanvasViewLazy />
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
                getObjectAppearance={getCanvasPostgresObjectAppearance}
                getObjectSurfaceStyle={getPostgresObjectSurfaceStyle}
                getRelationshipAppearance={getPostgresRelationshipAppearance}
                getRelationshipStrokeWidth={getPostgresRelationshipStrokeWidth}
                getNodeDefaultDimensions={(object, objectTypeRecord) => {
                  const appearance = getCanvasPostgresObjectAppearance(object, objectTypeRecord);
                  return appearance.sourceImage
                    ? getSourceCanvasNodeDefaultDimensions()
                    : getCanvasNodeDefaultDimensions(appearance.shape);
                }}
                getNodeRenderedDimensions={(object, objectTypeRecord, nodeState) => {
                  const appearance = getCanvasPostgresObjectAppearance(object, objectTypeRecord);
                  return appearance.sourceImage
                    ? getSourceCanvasNodeRenderedDimensions(nodeState)
                    : getCanvasNodeRenderedDimensions(appearance.shape, nodeState);
                }}
              />
            </Suspense>
          ) : activeScreen === "construct" ? (
            <div className="view users-view">
              <header className="view-header">
                <div>
                  <div className="users-title-wrap">
                    <h1>{t("projectCore.homeShell.savedCanvases.construct")}</h1>
                    <button
                      type="button"
                      className="users-help-icon-btn"
                      onClick={() => setProjectHelpModal("construct")}
                      title={t("projectCore.homeShell.savedCanvases.openConstructHelp")}
                      aria-label={t("projectCore.homeShell.savedCanvases.openConstructHelp")}
                    >
                      <HelpIcon className="users-help-icon" />
                    </button>
                  </div>
                  <p className="auth-hint" style={{ margin: "6px 0 0" }}>
                    {t("projectCore.homeShell.savedCanvases.constructDescription")}
                  </p>
                </div>
              </header>
              <div className="empty-state postgres-users-empty-state" style={{ minHeight: 420 }}>
                <p>{t("projectCore.homeShell.savedCanvases.constructPlaceholder")}</p>
              </div>
            </div>
          ) : activeScreen === "view" ? (
            <div className="view users-view">
              <header className="view-header">
                <div>
                  <div className="users-title-wrap">
                    <h1>{t("projectCore.homeShell.savedCanvases.view")}</h1>
                    <button
                      type="button"
                      className="users-help-icon-btn"
                      onClick={() => setProjectHelpModal("view")}
                      title={t("projectCore.homeShell.savedCanvases.openViewHelp")}
                      aria-label={t("projectCore.homeShell.savedCanvases.openViewHelp")}
                    >
                      <HelpIcon className="users-help-icon" />
                    </button>
                  </div>
                  <p className="auth-hint" style={{ margin: "6px 0 0" }}>
                    {t("projectCore.homeShell.savedCanvases.browseSaved")}
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
                      <h2 style={{ margin: 0, fontSize: 18 }}>{t("projectCore.homeShell.savedCanvases.canvasModes")}</h2>
                      <span className="home-restricted-value">3</span>
                    </div>

                    <div style={{ maxHeight: 560, overflowY: "auto" }}>
                      <table className="users-table" style={{ tableLayout: "fixed" }}>
                        <thead>
                          <tr>
                            <th className="users-th" style={{ width: "62%" }}>{t("projectCore.homeShell.savedCanvases.mode")}</th>
                            <th className="users-th" style={{ width: "38%" }}>{t("projectCore.homeShell.savedCanvases.saved")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            { id: "free_draw", label: t("projectCore.homeShell.savedCanvases.freeDraw") },
                            { id: "explore", label: t("projectCore.homeShell.savedCanvases.explore") },
                            { id: "construct", label: t("projectCore.homeShell.savedCanvases.construct") },
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
                      <p>{t("projectCore.homeShell.savedCanvases.loading")}</p>
                    </div>
                  ) : filteredSavedDrawings.length === 0 ? (
                    <div className="empty-state postgres-users-empty-state">
                      <p>{t("projectCore.homeShell.savedCanvases.noSavedPrefix")} {formatCanvasKindLabel(selectedCanvasViewKind).toLowerCase()} {t("projectCore.homeShell.savedCanvases.noSavedSuffix")}</p>
                    </div>
                  ) : (
                    <div className="users-table-wrap postgres-users-table-wrap">
                      <table className="users-table">
                        <thead>
                          <tr>
                            <th className="users-th" style={{ width: "30%" }}>{t("projectCore.homeShell.savedCanvases.name")}</th>
                            <th className="users-th" style={{ width: "16%" }}>{t("projectCore.homeShell.savedCanvases.mode")}</th>
                            <th className="users-th" style={{ width: "18%" }}>{t("projectCore.entities.created")}</th>
                            <th className="users-th" style={{ width: "18%" }}>{t("projectCore.entities.updated")}</th>
                            <th className="users-th" style={{ width: "18%" }}>{t("projectCore.homeShell.savedCanvases.actions")}</th>
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
                                  {t("projectCore.homeShell.savedCanvases.actions")}
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
                                      {t("projectCore.homeShell.savedCanvases.view")}
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
                                      {t("projectCore.sources.detail.edit")}
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
                                      {t("projectCore.homeShell.savedCanvases.export")}
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
                                      {t("common.delete")}
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
            <PostgresHomeCanvasContextMenu
              menu={homeCanvasContextMenu}
              canManageSources={canManageSources}
              canManageAnnotations={canManageAnnotations}
              canDeleteItems={canDeleteHomeCanvasItems}
              hasDeleteTarget={Boolean(getHomeCanvasDeleteTarget(homeCanvasContextMenu))}
              onClose={closeHomeCanvasContextMenu}
              onCreateSource={() => openCreateSourceModal()}
              onCreateObject={(preferredPosition) => openCreateObjectModal(undefined, preferredPosition)}
              onCreateRelationship={() => openCreateRelationshipModal()}
              onCreateCode={openCreateCodeModal}
              onEditCanvas={openHomeCanvasAppearanceModal}
              onViewDetails={viewHomeCanvasItem}
              onEditItem={editHomeCanvasItem}
              onRemoveFromGroup={(menu) => void handleRemoveHomeTimelineItemFromGroup(menu)}
              onDeleteItem={startHomeCanvasDelete}
              deleteLabel={activeScreen === "analysis-draw-canvas" ? t("projectCore.homeShell.savedCanvases.removeFromCanvas") : t("common.delete")}
              deleteDisabledTitle={activeScreen === "analysis-draw-canvas" ? t("projectCore.homeShell.savedCanvases.cannotEditDrawings") : undefined}
            />
          ) : null}
          {projectHelpModal ? (
            <SettingsModal
              title={t(POSTGRES_PROJECT_HELP_COPY[projectHelpModal].titleKey)}
              onClose={() => setProjectHelpModal(null)}
              modalClassName="modal--help"
            >
              <div className="app-settings-modal-body">
                {POSTGRES_PROJECT_HELP_COPY[projectHelpModal].lineKeys.map((lineKey) => (
                  <p key={lineKey} className="users-guide-copy">
                    {t(lineKey)}
                  </p>
                ))}
              </div>
              <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
                <button type="button" className="btn btn--primary" onClick={() => setProjectHelpModal(null)}>
                  {t("common.close")}
                </button>
              </div>
            </SettingsModal>
          ) : null}
          {homeCanvasAppearanceDraft ? (
            <PostgresCanvasAppearanceModal
              draft={homeCanvasAppearanceDraft}
              saving={homeCanvasAppearanceSaving}
              error={homeCanvasAppearanceError}
              defaultBackgroundColor={getAppDefaults(getStoredTheme())["--canvas-background"]}
              defaultGridColor={getAppDefaults(getStoredTheme())["--canvas-grid-color"]}
              onDraftChange={updateHomeCanvasAppearanceDraft}
              onReset={resetHomeCanvasAppearanceDraft}
              onDone={() => void closeHomeCanvasAppearanceModal()}
            />
          ) : null}
          {createRelationshipTypeOpen ? (
            <PostgresRelationshipTypeModal
              title={t("projectCore.homeShell.relationships.addRelationshipType")}
              submitLabel={t("projectCore.homeShell.relationships.addRelationshipType")}
              ariaLabel={t("projectCore.homeShell.relationships.addRelationshipType")}
              tab={relationshipTypeModalTab}
              setTab={setRelationshipTypeModalTab}
              projectStoragePath={project.storagePath}
              submitting={graphSubmitting}
              name={draftRelationshipTypeName}
              lineShape={draftRelationshipLineShape}
              lineWeight={draftRelationshipLineWeight}
              arrowhead={draftRelationshipArrowhead}
              color={draftRelationshipColor}
              fromObjectTypeIds={draftRelationshipFromObjectTypeIds}
              toObjectTypeIds={draftRelationshipToObjectTypeIds}
              fromSourceKinds={draftRelationshipFromSourceKinds}
              toSourceKinds={draftRelationshipToSourceKinds}
              objectRestrictionItems={getRelationshipObjectRestrictionItems()}
              sourceRestrictionItems={POSTGRES_SOURCE_KIND_OPTIONS}
              attributeDrafts={relationshipTypeAttributeDrafts}
              attributeRows={[]}
              attributeValues={relationshipTypeAttributeValuesByDraftId}
              emptyRowsLabel={t("projectCore.homeShell.relationships.noRelationshipsOfType")}
              onClose={() => setCreateRelationshipTypeOpen(false)}
              onSubmit={handleCreateRelationshipType}
              setName={setDraftRelationshipTypeName}
              setLineShape={setDraftRelationshipLineShape}
              setLineWeight={setDraftRelationshipLineWeight}
              setArrowhead={setDraftRelationshipArrowhead}
              setColor={setDraftRelationshipColor}
              setFromObjectTypeIds={setDraftRelationshipFromObjectTypeIds}
              setToObjectTypeIds={setDraftRelationshipToObjectTypeIds}
              setFromSourceKinds={setDraftRelationshipFromSourceKinds}
              setToSourceKinds={setDraftRelationshipToSourceKinds}
              onTimelineFieldChange={(role, value) => updateTimelineFieldDrafts(
                role,
                value,
                setRelationshipTypeAttributeDrafts,
                (draft) => {
                  setTypeAttributeModalError("");
                  setRelationshipTypeAttributeModalDraft(draft);
                },
              )}
              onAddAttribute={openNewRelationshipTypeAttributeModal}
              onEditAttribute={(localId) => {
                const draft = relationshipTypeAttributeDrafts.find((entry) => entry.localId === localId);
                if (draft) openEditRelationshipTypeAttributeModal(draft);
              }}
              onDeleteAttribute={deleteRelationshipTypeAttributeDraft}
              onChangeValue={updateRelationshipTypeMatrixValue}
            />
          ) : null}
          {objectTypeAttributeModalDraft ? (
            <AttributeDefinitionModal
              draft={objectTypeAttributeModalDraft}
              saving={graphSubmitting}
              error={typeAttributeModalError}
              title={objectTypeAttributeModalDraft.id ? t("projectCore.homeShell.objects.editObjectAttribute") : t("projectCore.homeShell.objects.createObjectAttribute")}
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
              title={relationshipTypeAttributeModalDraft.id ? t("projectCore.homeShell.relationships.editRelationshipAttribute") : t("projectCore.homeShell.relationships.createRelationshipAttribute")}
              overlayStyle={{ zIndex: 300 }}
              onCancel={() => {
                if (graphSubmitting) return;
                setRelationshipTypeAttributeModalDraft(null);
                setTypeAttributeModalError("");
              }}
              onSave={saveRelationshipTypeAttributeDraft}
            />
          ) : null}
          {drawCanvasSaveModalOpen ? (
            <SettingsModal
              title={t("projectCore.homeShell.savedCanvases.saveDrawing")}
              onClose={() => setDrawCanvasSaveModalOpen(false)}
              closeDisabled={drawCanvasSaving}
              modalClassName="modal--wide"
            >
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSaveGraphDrawCanvas();
                }}
              >
                <div className="app-settings-modal-body">
                  <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                    {t("projectCore.homeShell.savedCanvases.chooseDrawingName")}
                  </p>
                  <label className="form-field">
                    <span>{t("projectCore.homeShell.savedCanvases.drawingName")}</span>
                    <input
                      className="form-input"
                      value={saveFreeDrawName}
                      onChange={(event) => setSaveFreeDrawName(event.target.value)}
                      placeholder={t("projectCore.homeShell.savedCanvases.enterDrawingName")}
                      autoFocus
                      disabled={drawCanvasSaving}
                    />
                  </label>
                  {canvasSaveError ? <div className="form-error">{canvasSaveError}</div> : null}
                </div>
                <div className="app-settings-modal-footer">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setDrawCanvasSaveModalOpen(false)}
                    disabled={drawCanvasSaving}
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="submit"
                    className="btn btn--primary"
                    disabled={drawCanvasSaving}
                  >
                    {drawCanvasSaving ? t("projectCore.sources.saving") : t("projectCore.homeShell.savedCanvases.saveDrawing")}
                  </button>
                </div>
              </form>
            </SettingsModal>
          ) : null}
          {saveFreeDrawModalOpen ? (
            <SettingsModal
              title={t("projectCore.homeShell.savedCanvases.saveCanvas")}
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
                      {t("projectCore.homeShell.savedCanvases.chooseCanvasName")}
                    </p>
                    <label className="form-field">
                      <span>{t("projectCore.homeShell.savedCanvases.canvasName")}</span>
                      <input
                        className="form-input"
                        value={saveFreeDrawName}
                        onChange={(event) => setSaveFreeDrawName(event.target.value)}
                        placeholder={t("projectCore.homeShell.savedCanvases.enterCanvasName")}
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
                      {t("common.cancel")}
                    </button>
                    <button
                      type="submit"
                      className="btn btn--primary"
                      disabled={freeDrawSaving}
                    >
                      {freeDrawSaving ? t("projectCore.sources.saving") : t("projectCore.homeShell.savedCanvases.saveCanvas")}
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
                  title={t("projectCore.homeShell.savedCanvases.exportCanvas")}
                  onClose={() => setExportingSavedDrawingId(null)}
                  closeDisabled={savedDrawingExportBusyFormat !== null}
                  modalClassName="modal--wide"
                >
                  <div className="app-settings-modal-body">
                    <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                      {t("projectCore.homeShell.savedCanvases.exportPrompt", { name: drawing.name })}
                    </p>
                    <div className="form" style={{ gap: 12 }}>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void handleExportSavedDrawing("png")}
                        disabled={savedDrawingExportBusyFormat !== null}
                      >
                        {savedDrawingExportBusyFormat === "png" ? t("projectCore.homeShell.savedCanvases.exportingPng") : t("projectCore.homeShell.savedCanvases.exportAsPng")}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void handleExportSavedDrawing("pdf")}
                        disabled={savedDrawingExportBusyFormat !== null}
                      >
                        {savedDrawingExportBusyFormat === "pdf" ? t("projectCore.homeShell.savedCanvases.exportingPdf") : t("projectCore.homeShell.savedCanvases.exportAsPdf")}
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
                        {t("common.cancel")}
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
                  title={t("projectCore.homeShell.savedCanvases.deleteCanvas")}
                  warning={t("projectCore.homeShell.savedCanvases.deleteCanvasWarning")}
                  busy={graphSubmitting}
                  confirmLabel={t("projectCore.homeShell.savedCanvases.deleteCanvas")}
                  busyLabel={t("projectCore.sources.deleting")}
                  onClose={() => setRemovingSavedDrawingId(null)}
                  onConfirm={() => void handleDeleteSavedDrawing(drawing.id)}
                >
                    <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                      {t("projectCore.homeShell.savedCanvases.deletePrompt", { name: drawing.name })}
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
            <Suspense fallback={null}>
              <SourceImportModalLazy
                importSettings={sourceImportSettings}
                attributeDefinitions={sourceAttributeDefinitions}
                sourceTypeSettings={sourceTypeSettings}
                saving={graphSubmitting}
                error={graphError || null}
                onCancel={() => {
                  if (graphSubmitting) return;
                  setCreateSourceOpen(false);
                  setPendingTimelineCreateStart("");
                  setGraphError("");
                }}
                onSave={handleCreateSource}
              />
            </Suspense>
          ) : null}
          {editingHomeCanvasSource ? (
            <Suspense fallback={null}>
              <SourceEditorModalLazy
                title={t("projectCore.sources.editSource")}
                initialRow={editingHomeCanvasSource}
                projectStoragePath={project.storagePath}
                sourceTypeSettings={sourceTypeSettings}
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
            </Suspense>
          ) : null}
          {createCodeOpen ? (
            <NewCodeModal
              allCodes={codeRowsForModal}
              title={t("projectCodebook.modal.newTitle")}
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
              title={t("projectCodebook.modal.editTitle")}
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
            <PostgresObjectModal
              title={t("projectCore.homeShell.objects.createObject")}
              ariaLabel={t("projectCore.homeShell.objects.createObjectTabs")}
              tab={createObjectModalTab}
              setTab={setCreateObjectModalTab}
              submitLabel={t("projectCore.homeShell.objects.addObject")}
              objectTypes={objectTypes}
              projectStoragePath={project.storagePath}
              submitting={graphSubmitting}
              imageUploadSubmitting={imageUploadSubmitting}
              objectTypeId={objectTypeId}
              titleValue={objectTitle}
              descriptionValue={objectDescription}
              colorOverride={objectColorOverride}
              outlineColorOverride={objectOutlineColorOverride}
              shapeOverride={objectShapeOverride}
              fillOverride={objectFillOverride}
              fillTransparencyOverride={objectFillTransparencyOverride}
              outlineWidthOverride={objectOutlineWidthOverride}
              imageStoragePath={objectImageStoragePath}
              imagePreviewUrl={draftObjectPendingImage?.previewUrl ?? ""}
              graphicMode={objectGraphicMode}
              selectedType={selectedCreateObjectType}
              attributeDefinitions={objectAttributeDefinitionsForCreateType}
              attributeValues={objectAttributeValues}
              onClose={closeCreateObjectModal}
              onSubmit={handleCreateObject}
              setObjectTypeId={setCreateObjectTypeId}
              setTitleValue={setObjectTitle}
              setDescriptionValue={setObjectDescription}
              setColorOverride={setObjectColorOverride}
              setOutlineColorOverride={setObjectOutlineColorOverride}
              setShapeOverride={setObjectShapeOverride}
              setFillOverride={setObjectFillOverride}
              setFillTransparencyOverride={setObjectFillTransparencyOverride}
              setOutlineWidthOverride={setObjectOutlineWidthOverride}
              setImageStoragePath={setObjectImageStoragePath}
              setGraphicMode={setObjectGraphicMode}
              setAttributeValues={setObjectAttributeValues}
              onSetGraphicMode={handleSetObjectGraphicMode}
              onImportImage={() => void handlePickPendingObjectImage()}
              onRemoveImage={handleRemovePendingObjectImage}
              onClearPendingImage={handleRemovePendingObjectImage}
              onNewObjectType={openCreateObjectTypeModal}
            />
          ) : null}
          {createObjectTypeOpen ? (
            <PostgresObjectTypeModal
              title={t("projectCore.homeShell.objects.addObjectType")}
              subtitle={t("projectCore.homeShell.objects.createObjectTypeSubtitle")}
              ariaLabel={t("projectCore.homeShell.objects.createObjectTypeTabs")}
              tab={objectTypeModalTab}
              setTab={setObjectTypeModalTab}
              submitLabel={t("projectCore.homeShell.objects.createObjectType")}
              projectStoragePath={project.storagePath}
              submitting={graphSubmitting}
              imageUploadSubmitting={imageUploadSubmitting}
              name={draftObjectTypeName}
              description={draftObjectTypeDescription}
              shape={draftObjectTypeShape}
              color={draftObjectTypeColor}
              outlineColor={draftObjectTypeOutlineColor}
              fill={draftObjectTypeFill}
              fillTransparency={draftObjectTypeFillTransparency}
              outlineWidth={draftObjectTypeOutlineWidth}
              imageStoragePath={draftObjectTypeImageStoragePath}
              imagePreviewUrl={draftObjectTypePendingImage?.previewUrl ?? ""}
              graphicMode={draftObjectTypeGraphicMode}
              attributeDrafts={objectTypeAttributeDrafts}
              attributeRows={[]}
              attributeValues={objectTypeAttributeValuesByDraftId}
              emptyRowsLabel={t("projectCore.homeShell.objects.createObjectTypeBeforeValues")}
              onClose={() => setCreateObjectTypeOpen(false)}
              onSubmit={handleCreateObjectType}
              setName={setDraftObjectTypeName}
              setDescription={setDraftObjectTypeDescription}
              setShape={setDraftObjectTypeShape}
              setColor={setDraftObjectTypeColor}
              setOutlineColor={setDraftObjectTypeOutlineColor}
              setFill={setDraftObjectTypeFill}
              setFillTransparency={setDraftObjectTypeFillTransparency}
              setOutlineWidth={setDraftObjectTypeOutlineWidth}
              onGraphicModeChange={handleSetObjectTypeGraphicMode}
              onImportImage={() => void handlePickPendingObjectTypeImage()}
              onRemoveImage={handleRemovePendingObjectTypeImage}
              onTimelineFieldChange={(role, value) => updateTimelineFieldDrafts(
                role,
                value,
                setObjectTypeAttributeDrafts,
                (draft) => {
                  setTypeAttributeModalError("");
                  setObjectTypeAttributeModalDraft(draft);
                },
              )}
              onAddAttribute={openNewObjectTypeAttributeModal}
              onEditAttribute={(localId) => {
                const draft = objectTypeAttributeDrafts.find((entry) => entry.localId === localId);
                if (draft) openEditObjectTypeAttributeModal(draft);
              }}
              onDeleteAttribute={deleteObjectTypeAttributeDraft}
              onChangeValue={updateObjectTypeMatrixValue}
            />
          ) : null}
          {editingObjectId ? (
            <PostgresObjectModal
              title={t("projectCore.homeShell.objects.editObjectLower")}
              ariaLabel={t("projectCore.homeShell.objects.editObjectTabs")}
              tab={editObjectModalTab}
              setTab={setEditObjectModalTab}
              submitLabel={t("projectCore.homeShell.objects.saveChanges")}
              objectTypes={objectTypes}
              projectStoragePath={project.storagePath}
              submitting={graphSubmitting}
              imageUploadSubmitting={imageUploadSubmitting}
              activeObjectId={editingObjectId}
              objectTypeId={editingObjectTypeId}
              titleValue={editingObjectTitle}
              descriptionValue={editingObjectDescription}
              colorOverride={editingObjectColorOverride}
              outlineColorOverride={editingObjectOutlineColorOverride}
              shapeOverride={editingObjectShapeOverride}
              fillOverride={editingObjectFillOverride}
              fillTransparencyOverride={editingObjectFillTransparencyOverride}
              outlineWidthOverride={editingObjectOutlineWidthOverride}
              imageStoragePath={editingObjectImageStoragePath}
              graphicMode={editingObjectGraphicMode}
              selectedType={selectedEditObjectType}
              attributeDefinitions={objectAttributeDefinitionsForEditingType}
              attributeValues={editingObjectAttributeValues}
              onClose={() => setEditingObjectId(null)}
              onSubmit={handleSaveObject}
              setObjectTypeId={setEditingObjectTypeId}
              setTitleValue={setEditingObjectTitle}
              setDescriptionValue={setEditingObjectDescription}
              setColorOverride={setEditingObjectColorOverride}
              setOutlineColorOverride={setEditingObjectOutlineColorOverride}
              setShapeOverride={setEditingObjectShapeOverride}
              setFillOverride={setEditingObjectFillOverride}
              setFillTransparencyOverride={setEditingObjectFillTransparencyOverride}
              setOutlineWidthOverride={setEditingObjectOutlineWidthOverride}
              setImageStoragePath={setEditingObjectImageStoragePath}
              setGraphicMode={setEditingObjectGraphicMode}
              setAttributeValues={setEditingObjectAttributeValues}
              onSetGraphicMode={handleSetObjectGraphicMode}
              onImportImage={() => void handleImportEditingObjectImage(editingObjectId)}
              onRemoveImage={() => void handleRemoveEditingObjectImage(editingObjectId)}
              hideEmptyUploadPreview
            />
          ) : null}
          <PostgresHomeRelationshipModals
            createOpen={createRelationshipOpen}
            editingRelationshipId={editingRelationshipId}
            createTab={createRelationshipModalTab}
            setCreateTab={setCreateRelationshipModalTab}
            editTab={editRelationshipModalTab}
            setEditTab={setEditRelationshipModalTab}
            submitting={graphSubmitting}
            error={graphError || null}
            createDraft={{
              relationshipTypes,
              relationshipTypeId,
              setRelationshipTypeId: setCreateRelationshipTypeId,
              selectedType: selectedRelationshipType,
              fromEndpointKey: fromObjectId,
              setFromEndpointKey: setFromObjectId,
              toEndpointKey: toObjectId,
              setToEndpointKey: setToObjectId,
              availableFromEndpoints: availableFromEndpointOptions,
              availableToEndpoints: availableToEndpointOptions,
              description: relationshipDescription,
              setDescription: setRelationshipDescription,
              lineShapeOverride: relationshipLineShapeOverride,
              setLineShapeOverride: setRelationshipLineShapeOverride,
              lineWeightOverride: relationshipLineWeightOverride,
              setLineWeightOverride: setRelationshipLineWeightOverride,
              arrowheadOverride: relationshipArrowheadOverride,
              setArrowheadOverride: setRelationshipArrowheadOverride,
              colorOverride: relationshipColorOverride,
              setColorOverride: setRelationshipColorOverride,
              attributeDefinitions: relationshipAttributeDefinitionsForCreateType,
              attributeValues: relationshipAttributeValues,
              setAttributeValues: setRelationshipAttributeValues,
              submitDisabled: !fromObjectId || !toObjectId,
            }}
            editDraft={{
              relationshipTypes,
              relationshipTypeId: editingRelationshipTypeId,
              setRelationshipTypeId: setEditingRelationshipTypeId,
              selectedType: editingRelationshipTypeRecord,
              fromEndpointKey: editingRelationshipFromObjectId,
              setFromEndpointKey: setEditingRelationshipFromObjectId,
              toEndpointKey: editingRelationshipToObjectId,
              setToEndpointKey: setEditingRelationshipToObjectId,
              availableFromEndpoints: availableEditingFromEndpointOptions,
              availableToEndpoints: availableEditingToEndpointOptions,
              description: editingRelationshipDescription,
              setDescription: setEditingRelationshipDescription,
              lineShapeOverride: editingRelationshipLineShapeOverride,
              setLineShapeOverride: setEditingRelationshipLineShapeOverride,
              lineWeightOverride: editingRelationshipLineWeightOverride,
              setLineWeightOverride: setEditingRelationshipLineWeightOverride,
              arrowheadOverride: editingRelationshipArrowheadOverride,
              setArrowheadOverride: setEditingRelationshipArrowheadOverride,
              colorOverride: editingRelationshipColorOverride,
              setColorOverride: setEditingRelationshipColorOverride,
              attributeDefinitions: relationshipAttributeDefinitionsForEditingType,
              attributeValues: editingRelationshipAttributeValues,
              setAttributeValues: setEditingRelationshipAttributeValues,
              submitDisabled: !editingRelationshipFromObjectId || !editingRelationshipToObjectId,
            }}
            onCloseCreate={closeCreateRelationshipModal}
            onCloseEdit={() => setEditingRelationshipId(null)}
            onCreateSubmit={handleCreateRelationship}
            onEditSubmit={(event) => {
              void handleSaveRelationship(event);
            }}
            onNewRelationshipTypeFromCreate={openCreateRelationshipTypeModal}
            onNewRelationshipTypeFromEdit={() => setCreateRelationshipTypeOpen(true)}
          />
          {activeScreen !== "objects" && removingObjectId ? (
            (() => {
              const object = objects.find((entry) => entry.id === removingObjectId);
              if (!object) return null;
              return (
                <GraphConfirmModal
                  title={t("projectCore.homeShell.objects.deleteObjectLower")}
                  warning={t("projectCore.homeShell.objects.deleteWarning")}
                  busy={graphSubmitting}
                  confirmLabel={t("projectCore.homeShell.objects.deleteObjectLower")}
                  busyLabel={t("projectCore.sources.deleting")}
                  onClose={() => setRemovingObjectId(null)}
                  onConfirm={() => void handleDeleteObject(object.id)}
                >
                    <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                      {t("projectCore.homeShell.objects.deletePrompt", { name: object.title })}
                    </p>
                </GraphConfirmModal>
              );
            })()
          ) : null}
          {(activeScreen !== "relationships" || selectedRelationshipDetails) && removingRelationshipId ? (
            (() => {
              const relationship = relationships.find((entry) => entry.id === removingRelationshipId);
              if (!relationship) return null;
              return (
                <GraphConfirmModal
                  title={t("projectCore.homeShell.relationships.deleteRelationshipLower")}
                  warning={t("projectCore.homeShell.relationships.deleteRelationshipWarning")}
                  busy={graphSubmitting}
                  confirmLabel={t("projectCore.homeShell.relationships.deleteRelationshipLower")}
                  busyLabel={t("projectCore.sources.deleting")}
                  onClose={() => setRemovingRelationshipId(null)}
                  onConfirm={() => void handleDeleteRelationship(relationship.id)}
                >
                    <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                      {t("projectCore.homeShell.relationships.deletePrompt", { name: relationship.relationshipType })}
                    </p>
                </GraphConfirmModal>
              );
            })()
          ) : null}
          {homeCanvasDeleteTarget ? (
            <GraphConfirmModal
              title={homeCanvasDeleteTarget.canvasOnly
                ? t("projectCore.homeShell.savedCanvases.removeItemFromCanvasTitle", { kind: homeCanvasDeleteTarget.kind })
                : t("projectCore.homeShell.savedCanvases.deleteItemTitle", { kind: homeCanvasDeleteTarget.kind })}
              warning={homeCanvasDeleteTarget.canvasOnly
                ? t("projectCore.homeShell.savedCanvases.removeFromDrawingBody", { itemType: homeCanvasDeleteTarget.kind })
                : homeCanvasDeleteTarget.kind === "object"
                  ? t("projectCore.homeShell.savedCanvases.permanentDeleteObjectBody", { itemType: homeCanvasDeleteTarget.kind })
                  : homeCanvasDeleteTarget.kind === "source"
                    ? t("projectCore.homeShell.savedCanvases.permanentDeleteSourceBody", { itemType: homeCanvasDeleteTarget.kind })
                    : homeCanvasDeleteTarget.kind === "code"
                      ? t("projectCore.homeShell.savedCanvases.permanentDeleteCodeBody", { itemType: homeCanvasDeleteTarget.kind })
                      : t("projectCore.homeShell.savedCanvases.permanentDeleteBody", { itemType: homeCanvasDeleteTarget.kind })}
              busy={graphSubmitting}
              confirmLabel={homeCanvasDeleteTarget.canvasOnly ? t("projectCore.homeShell.savedCanvases.removeFromCanvas") : t("common.delete")}
              busyLabel={t("projectCore.sources.deleting")}
              confirmDisabled={!canDeleteHomeCanvasItems}
              onClose={() => setHomeCanvasDeleteTarget(null)}
              onConfirm={() => {
                if (canDeleteHomeCanvasItems) void handleConfirmHomeCanvasDelete();
              }}
            >
                <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                  {homeCanvasDeleteTarget.canvasOnly
                    ? t("projectCore.homeShell.savedCanvases.removePrompt", { name: homeCanvasDeleteTarget.label })
                    : t("projectCore.homeShell.savedCanvases.deletePrompt", { name: homeCanvasDeleteTarget.label })}
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
