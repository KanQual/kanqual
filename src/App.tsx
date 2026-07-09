import {
  Component,
  type ComponentType,
  type CSSProperties,
  type Dispatch,
  type ErrorInfo,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
  type SetStateAction,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import Color from "@tiptap/extension-color";
import TextAlign from "@tiptap/extension-text-align";
import { FontSize as TiptapFontSize, TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import cytoscape, { type Core as CytoscapeCore, type ElementDefinition, type StylesheetJson } from "cytoscape";
import ELK from "elkjs/lib/elk.bundled.js";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import circleFilledShapeSvg from "./assets/object-shapes/circle-filled.svg?raw";
import circleOutlineShapeSvg from "./assets/object-shapes/circle-outline.svg?raw";
import rectangleFilledShapeSvg from "./assets/object-shapes/rectangle-filled.svg?raw";
import rectangleOutlineShapeSvg from "./assets/object-shapes/rectangle-outline.svg?raw";
import triangleFilledShapeSvg from "./assets/object-shapes/triangle-filled.svg?raw";
import triangleOutlineShapeSvg from "./assets/object-shapes/triangle-outline.svg?raw";
import diamondFilledShapeSvg from "./assets/object-shapes/diamond-filled.svg?raw";
import diamondOutlineShapeSvg from "./assets/object-shapes/diamond-outline.svg?raw";
import hexagonFilledShapeSvg from "./assets/object-shapes/hexagon-filled.svg?raw";
import hexagonOutlineShapeSvg from "./assets/object-shapes/hexagon-outline.svg?raw";
import octagonFilledShapeSvg from "./assets/object-shapes/octagon-filled.svg?raw";
import octagonOutlineShapeSvg from "./assets/object-shapes/octagon-outline.svg?raw";
import parallelogramFilledShapeSvg from "./assets/object-shapes/parallelogram-filled.svg?raw";
import parallelogramOutlineShapeSvg from "./assets/object-shapes/parallelogram-outline.svg?raw";
import trapezoidFilledShapeSvg from "./assets/object-shapes/trapezoid-filled.svg?raw";
import trapezoidOutlineShapeSvg from "./assets/object-shapes/trapezoid-outline.svg?raw";
import tagFilledShapeSvg from "./assets/object-shapes/tag-filled.svg?raw";
import tagOutlineShapeSvg from "./assets/object-shapes/tag-outline.svg?raw";
import starFilledShapeSvg from "./assets/object-shapes/star-filled.svg?raw";
import starOutlineShapeSvg from "./assets/object-shapes/star-outline.svg?raw";
import sourceTextOutlineShapeSvg from "./assets/object-shapes/source-text-outline.svg?raw";
import sourceImageOutlineShapeSvg from "./assets/object-shapes/source-image-outline.svg?raw";
import sourceAudioOutlineShapeSvg from "./assets/object-shapes/source-audio-outline.svg?raw";
import sourceVideoOutlineShapeSvg from "./assets/object-shapes/source-video-outline.svg?raw";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { StoreProvider, useStore } from "./context/StoreContext";
import { I18nProvider } from "./i18n";
import { LOCALE_LABELS, SUPPORTED_LOCALES } from "./i18n";
import { useI18n } from "./i18n/provider";
import { formatCurrentDateTime } from "./i18n/formatters";
import { APP_SETTINGS_KEY, readAppSettings, saveAppSettings } from "./lib/appSettings";
import { getAppRuntimeInfo } from "./lib/dataRoot";
import {
  bootstrapPostgresExperiment,
  changePostgresExperimentAppUserPassword,
  clearPostgresExperimentRememberedAccounts,
  clearPostgresExperimentUserProjectState,
  deletePostgresExperimentObjectType,
  createPostgresExperimentProject,
  createPostgresExperimentRelationshipAttributeDefinition,
  deletePostgresExperimentObject,
  deletePostgresExperimentProject,
  getPostgresExperimentAuthStatus,
  getPostgresExperimentDeviceState,
  getPostgresExperimentInstallationSettings,
  getPostgresExperimentProjectAiAssistSettings,
  getPostgresExperimentProjectCanvasState,
  getPostgresExperimentSavedDrawing,
  getPostgresExperimentProjectDocumentImportSettings,
  getPostgresExperimentUserProjectState,
  loginPostgresExperimentAdmin,
  loginPostgresExperimentAppUser,
  logoutPostgresExperimentAppUser,
  listPostgresExperimentRememberedAccounts,
  createPostgresExperimentProjectUser,
  deletePostgresExperimentProjectUser,
  deletePostgresExperimentRelationship,
  deletePostgresExperimentRelationshipType,
  deletePostgresExperimentSavedDrawing,
  completePostgresAdminHandoff,
  getPostgresExperimentStatus,
  listPostgresExperimentAppUsers,
  listPostgresExperimentObjects,
  listPostgresExperimentObjectTypes,
  listPostgresExperimentObjectAttributeDefinitions,
  listPostgresExperimentProjects,
  listPostgresExperimentProjectUsers,
  listPostgresExperimentRelationshipTypes,
  listPostgresExperimentRelationshipAttributeDefinitions,
  listPostgresExperimentRelationships,
  listPostgresExperimentSavedDrawingSummaries,
  rememberPostgresExperimentAccount,
  rememberPostgresExperimentProjectOpened,
  renamePostgresExperimentRememberedAccount,
  removePostgresExperimentProjectFromState,
  registerPostgresExperimentAppUser,
  savePostgresExperimentDeviceState,
  savePostgresExperimentInstallationSettings,
  savePostgresExperimentProjectAiAssistSettings,
  savePostgresExperimentProjectCanvasState,
  savePostgresExperimentProjectDocumentImportSettings,
  savePostgresExperimentSavedDrawing,
  savePostgresExperimentObject,
  savePostgresExperimentObjectType,
  savePostgresExperimentRelationship,
  savePostgresExperimentRelationshipType,
  savePostgresExperimentUserPreferences,
  updatePostgresExperimentAppUserProfile,
  updatePostgresExperimentProject,
  updatePostgresExperimentProjectUser,
  updatePostgresExperimentRelationshipAttributeDefinition,
  getPostgresExperimentUserPreferences,
  type PostgresExperimentAppUser,
  type PostgresExperimentAuthSession,
  type PostgresExperimentAuthStatus,
  type PostgresExperimentInstallationSettings,
  type PostgresExperimentObject,
  type PostgresExperimentObjectType,
  type PostgresExperimentObjectAttributeDefinition,
  type PostgresExperimentProjectAiAssistSettings,
  type PostgresExperimentProject,
  type PostgresExperimentProjectChangeEvent,
  type PostgresExperimentProjectDocumentImportSettings,
  type PostgresExperimentProjectUser,
  type PostgresExperimentRecentProject,
  type PostgresExperimentRememberedAccount,
  type PostgresExperimentRelationship,
  type PostgresExperimentRelationshipType,
  type PostgresExperimentRelationshipAttributeDefinition,
  type PostgresExperimentSavedDrawing,
  type PostgresExperimentSavedDrawingSummary,
  type PostgresExperimentStatus,
  type PostgresExperimentUserPreferences,
  type PostgresExperimentCanvasNodeState,
  type PostgresExperimentCanvasDisplayShape,
  type PostgresExperimentCanvasPoint,
  type PostgresExperimentCanvasShape,
  POSTGRES_PROJECT_CHANGED_EVENT,
} from "./lib/postgresExperiment";
import {
  loadProjectBackupBannerIssue,
  OPEN_PROJECT_SETTINGS_MODAL_EVENT,
  PROJECT_BACKUPS_CHANGED_EVENT,
  type ProjectBackupBannerIssue,
} from "./lib/projectBackupBanner";
// @ts-expect-error cytoscape-grid-guide does not ship TypeScript declarations.
import gridGuide from "cytoscape-grid-guide";
import { getSmokeTestConfig, updateSmokeTestState } from "./lib/smokeTest";
import {
  applyDensity,
  applyFontSize,
  applyTheme,
  getStoredTheme,
  getStoredThemeState,
  initTheme,
  setActivePresetId,
  setRuntimeThemePreferences,
  type Density,
  type FontSize,
  type Theme,
} from "./theme";
import {
  AttributeValuesModal,
  type SharedAttributeDraft,
} from "./components/AttributeValuesModal";
import { AttributeDefinitionModal } from "./components/AttributeDefinitionModal";
import { Sidebar } from "./components/Sidebar";
import { AuthView } from "./views/Auth_View";
import { ThemeManagerModal } from "./components/ThemeManagerModal";
import { useAutomaticProjectBackups } from "./hooks/useAutomaticProjectBackups";
import sidebarLogo from "./assets/logo-no-background.png";
import "./App.css";

gridGuide(cytoscape);

function lazyView<T extends ComponentType<unknown>>(loader: () => Promise<{ default: T }>) {
  return lazy(loader);
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function formatRecentLogin(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  const time = formatCurrentDateTime(date, { hour: "2-digit", minute: "2-digit" });
  if (days === 0) return `Today at ${time}`;
  if (days === 1) return `Yesterday at ${time}`;
  const shortDate = date.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${shortDate} at ${time}`;
}

function clampIntegerValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function syncLegacyAppSettingsFromPostgresInstallationSettings(
  installationSettings: PostgresExperimentInstallationSettings,
): void {
  const current = readAppSettings();
  saveAppSettings({
    ...current,
    startup: {
      ...current.startup,
      autoLoginLastUser: installationSettings.startupAutoLoginLastUser,
      reopenLastProject: installationSettings.startupReopenLastProject,
    },
    documentImport: {
      ...current.documentImport,
      defaultMode: installationSettings.documentImportDefaultMode,
      autoNameFromFile: installationSettings.documentImportAutoNameFromFile,
      trimImportedText: installationSettings.documentImportTrimImportedText,
      warnBeforeEmptyImport: installationSettings.documentImportWarnBeforeEmptyImport,
    },
    privacy: {
      ...current.privacy,
      maskFilePaths: installationSettings.privacyMaskFilePaths,
      clearRecentProjectsOnSignOut: installationSettings.privacyClearRecentProjectsOnSignOut,
      forgetLoginIdentitiesOnLogout: installationSettings.privacyForgetLoginIdentitiesOnLogout,
    },
    updates: {
      ...current.updates,
      autoCheck: installationSettings.updatesAutoCheck,
    },
    llm: {
      ...current.llm,
      ...installationSettings.llm,
    },
  });
}

function shouldRememberPostgresSession(
  installationSettings: PostgresExperimentInstallationSettings | null,
): boolean {
  return installationSettings?.startupAutoLoginLastUser ?? false;
}

function applyPostgresRuntimeThemePreferences(preferences: PostgresExperimentUserPreferences): void {
  setRuntimeThemePreferences({
    theme: preferences.theme,
    density: preferences.density,
    fontSize: preferences.fontSize,
    themeState: preferences.themeState,
  });
  initTheme();
}

function accountInitials(name: string): string {
  return (name || "?")
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

type PostgresExperimentObjectTypeShape =
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
type PostgresExperimentSourceObjectVisualKey =
  | "source_text"
  | "source_image"
  | "source_audio"
  | "source_video";
type PostgresExperimentObjectFill = "filled" | "outline";
type PostgresExperimentRelationshipLineShape = "solid" | "dashed" | "dotted";
type PostgresExperimentRelationshipArrowhead = "one_sided" | "double_sided" | "none";
type PostgresExperimentObjectTypeSortCol = "objectType" | "count";
type PostgresExperimentRelationshipAttributeDraft = SharedAttributeDraft;
type TypeAttributeDraft = SharedAttributeDraft & { localId: string };
type PostgresExperimentCanvasTool = "select" | "hand" | "connect" | "pen" | "shape" | "text" | "eraser";
type PostgresExperimentCanvasAutoLayoutMode = "layered";

const POSTGRES_OBJECT_TYPE_DEFAULT_COLOR = "#355070";
const POSTGRES_RELATIONSHIP_DEFAULT_COLOR = "#355070";
const postgresExperimentExploreElk = new ELK();
const POSTGRES_OBJECT_TYPE_SHAPE_OPTIONS: { value: PostgresExperimentObjectTypeShape; label: string }[] = [
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
const POSTGRES_OBJECT_FILL_OPTIONS: { value: PostgresExperimentObjectFill; label: string }[] = [
  { value: "filled", label: "Filled" },
  { value: "outline", label: "Outline" },
];
const POSTGRES_RELATIONSHIP_LINE_SHAPE_OPTIONS: { value: PostgresExperimentRelationshipLineShape; label: string }[] = [
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
const POSTGRES_RELATIONSHIP_ARROWHEAD_OPTIONS: { value: PostgresExperimentRelationshipArrowhead; label: string }[] = [
  { value: "one_sided", label: "One-sided" },
  { value: "double_sided", label: "Double-sided" },
  { value: "none", label: "No arrows" },
];
function buildSvgDataUrl(svgMarkup: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svgMarkup)}`;
}

const POSTGRES_OBJECT_SHAPE_ASSET_URLS: Record<
  PostgresExperimentObjectTypeShape,
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
  PostgresExperimentSourceObjectVisualKey,
  string
> = {
  source_text: buildSvgDataUrl(sourceTextOutlineShapeSvg),
  source_image: buildSvgDataUrl(sourceImageOutlineShapeSvg),
  source_audio: buildSvgDataUrl(sourceAudioOutlineShapeSvg),
  source_video: buildSvgDataUrl(sourceVideoOutlineShapeSvg),
};

function isPostgresExperimentSourceObjectVisualKey(
  value: string | null | undefined,
): value is PostgresExperimentSourceObjectVisualKey {
  return value === "source_text"
    || value === "source_image"
    || value === "source_audio"
    || value === "source_video";
}

function getPostgresExperimentSourceObjectVisualKey(
  systemKey: string | null | undefined,
): PostgresExperimentSourceObjectVisualKey | null {
  return isPostgresExperimentSourceObjectVisualKey(systemKey) ? systemKey : null;
}

function normalizePostgresExperimentObjectTypeShape(value: string): PostgresExperimentObjectTypeShape {
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

function normalizePostgresExperimentRelationshipLineShape(value: string): PostgresExperimentRelationshipLineShape {
  const normalized = value.trim().toLowerCase();
  if (normalized === "dashed" || normalized === "dotted") return normalized;
  return "solid";
}

function normalizePostgresExperimentRelationshipLineWeight(value: number | null | undefined): number {
  if (value === 1 || value === 3 || value === 4) return value;
  return 2;
}

function normalizePostgresExperimentRelationshipArrowhead(value: string): PostgresExperimentRelationshipArrowhead {
  const normalized = value.trim().toLowerCase();
  if (normalized === "double_sided" || normalized === "none") return normalized;
  return "one_sided";
}

function normalizePostgresExperimentObjectTypeColor(value: string): string {
  const normalized = value.trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : POSTGRES_OBJECT_TYPE_DEFAULT_COLOR;
}

function normalizePostgresExperimentObjectFill(value: string): PostgresExperimentObjectFill {
  return value.trim().toLowerCase() === "outline" ? "outline" : "filled";
}

function normalizeOptionalPostgresExperimentObjectTypeColor(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : "";
}

function normalizePostgresExperimentRelationshipColor(value: string): string {
  const normalized = value.trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : POSTGRES_RELATIONSHIP_DEFAULT_COLOR;
}

function normalizeOptionalPostgresExperimentRelationshipColor(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : "";
}

function resolvePostgresExperimentObjectShape(
  object: Pick<PostgresExperimentObject, "shapeOverride">,
  objectTypeRecord: Pick<PostgresExperimentObjectType, "shape"> | null,
): PostgresExperimentObjectTypeShape {
  return normalizePostgresExperimentObjectTypeShape(object.shapeOverride || objectTypeRecord?.shape || "");
}

function resolvePostgresExperimentObjectColor(
  object: Pick<PostgresExperimentObject, "colorOverride">,
  objectTypeRecord: Pick<PostgresExperimentObjectType, "color"> | null,
): string {
  return normalizePostgresExperimentObjectTypeColor(object.colorOverride || objectTypeRecord?.color || "");
}

function resolvePostgresExperimentObjectFill(
  object: Pick<PostgresExperimentObject, "fillOverride">,
  objectTypeRecord: Pick<PostgresExperimentObjectType, "fill"> | null,
): PostgresExperimentObjectFill {
  return normalizePostgresExperimentObjectFill(object.fillOverride || objectTypeRecord?.fill || "");
}

function getPostgresExperimentObjectAppearance(
  object: Pick<PostgresExperimentObject, "shapeOverride" | "colorOverride" | "fillOverride">,
  objectTypeRecord: Pick<PostgresExperimentObjectType, "shape" | "color" | "fill" | "systemKey"> | null,
): {
  shape: PostgresExperimentObjectTypeShape;
  color: string;
  fill: PostgresExperimentObjectFill;
  sourceVisualKey: PostgresExperimentSourceObjectVisualKey | null;
  hasShapeOverride: boolean;
  hasColorOverride: boolean;
  hasFillOverride: boolean;
} {
  return {
    shape: resolvePostgresExperimentObjectShape(object, objectTypeRecord),
    color: resolvePostgresExperimentObjectColor(object, objectTypeRecord),
    fill: resolvePostgresExperimentObjectFill(object, objectTypeRecord),
    sourceVisualKey: getPostgresExperimentSourceObjectVisualKey(objectTypeRecord?.systemKey),
    hasShapeOverride: !!object.shapeOverride.trim(),
    hasColorOverride: !!object.colorOverride.trim(),
    hasFillOverride: !!object.fillOverride.trim(),
  };
}

function formatPostgresExperimentObjectShapeLabel(shape: PostgresExperimentObjectTypeShape): string {
  return POSTGRES_OBJECT_TYPE_SHAPE_OPTIONS.find((option) => option.value === shape)?.label ?? "Circle";
}

function formatPostgresExperimentObjectFillLabel(fill: PostgresExperimentObjectFill): string {
  return POSTGRES_OBJECT_FILL_OPTIONS.find((option) => option.value === fill)?.label ?? "Filled";
}

function resolvePostgresExperimentRelationshipLineShape(
  relationship: Pick<PostgresExperimentRelationship, "lineShapeOverride">,
  relationshipTypeRecord: Pick<PostgresExperimentRelationshipType, "lineShape"> | null,
): PostgresExperimentRelationshipLineShape {
  return normalizePostgresExperimentRelationshipLineShape(
    relationship.lineShapeOverride || relationshipTypeRecord?.lineShape || "",
  );
}

function resolvePostgresExperimentRelationshipColor(
  relationship: Pick<PostgresExperimentRelationship, "colorOverride">,
  relationshipTypeRecord: Pick<PostgresExperimentRelationshipType, "color"> | null,
): string {
  return normalizePostgresExperimentRelationshipColor(
    relationship.colorOverride || relationshipTypeRecord?.color || "",
  );
}

function resolvePostgresExperimentRelationshipLineWeight(
  relationship: Pick<PostgresExperimentRelationship, "lineWeightOverride">,
  relationshipTypeRecord: Pick<PostgresExperimentRelationshipType, "lineWeight"> | null,
): number {
  return normalizePostgresExperimentRelationshipLineWeight(
    relationship.lineWeightOverride ?? relationshipTypeRecord?.lineWeight,
  );
}

function resolvePostgresExperimentRelationshipArrowhead(
  relationship: Pick<PostgresExperimentRelationship, "arrowheadOverride">,
  relationshipTypeRecord: Pick<PostgresExperimentRelationshipType, "arrowhead"> | null,
): PostgresExperimentRelationshipArrowhead {
  return normalizePostgresExperimentRelationshipArrowhead(
    relationship.arrowheadOverride || relationshipTypeRecord?.arrowhead || "",
  );
}

function getPostgresExperimentRelationshipAppearance(
  relationship: Pick<PostgresExperimentRelationship, "lineShapeOverride" | "lineWeightOverride" | "arrowheadOverride" | "colorOverride">,
  relationshipTypeRecord: Pick<PostgresExperimentRelationshipType, "lineShape" | "lineWeight" | "arrowhead" | "color"> | null,
): {
  lineShape: PostgresExperimentRelationshipLineShape;
  lineWeight: number;
  arrowhead: PostgresExperimentRelationshipArrowhead;
  color: string;
  hasLineShapeOverride: boolean;
  hasLineWeightOverride: boolean;
  hasArrowheadOverride: boolean;
  hasColorOverride: boolean;
} {
  return {
    lineShape: resolvePostgresExperimentRelationshipLineShape(relationship, relationshipTypeRecord),
    lineWeight: resolvePostgresExperimentRelationshipLineWeight(relationship, relationshipTypeRecord),
    arrowhead: resolvePostgresExperimentRelationshipArrowhead(relationship, relationshipTypeRecord),
    color: resolvePostgresExperimentRelationshipColor(relationship, relationshipTypeRecord),
    hasLineShapeOverride: !!relationship.lineShapeOverride.trim(),
    hasLineWeightOverride: relationship.lineWeightOverride !== null && relationship.lineWeightOverride !== undefined,
    hasArrowheadOverride: !!relationship.arrowheadOverride.trim(),
    hasColorOverride: !!relationship.colorOverride.trim(),
  };
}

function formatPostgresExperimentRelationshipLineShapeLabel(lineShape: PostgresExperimentRelationshipLineShape): string {
  return POSTGRES_RELATIONSHIP_LINE_SHAPE_OPTIONS.find((option) => option.value === lineShape)?.label ?? "Solid";
}

function formatPostgresExperimentRelationshipLineWeightLabel(lineWeight: number): string {
  return POSTGRES_RELATIONSHIP_LINE_WEIGHT_OPTIONS.find((option) => option.value === lineWeight)?.label ?? "Regular";
}

function formatPostgresExperimentRelationshipArrowheadLabel(arrowhead: PostgresExperimentRelationshipArrowhead): string {
  return POSTGRES_RELATIONSHIP_ARROWHEAD_OPTIONS.find((option) => option.value === arrowhead)?.label ?? "One-sided";
}

function getPostgresExperimentRelationshipStrokeWidth(lineWeight: number): number {
  const normalized = normalizePostgresExperimentRelationshipLineWeight(lineWeight);
  if (normalized === 1) return 1.5;
  if (normalized === 3) return 4;
  if (normalized === 4) return 5.5;
  return 2.5;
}

function PostgresExperimentObjectShapePicker(props: {
  value: PostgresExperimentObjectTypeShape | "";
  onChange: (value: PostgresExperimentObjectTypeShape | "") => void;
  previewColor: string;
  previewFill?: PostgresExperimentObjectFill;
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

function PostgresExperimentObjectFillPicker(props: {
  value: PostgresExperimentObjectFill | "";
  onChange: (value: PostgresExperimentObjectFill | "") => void;
  previewColor: string;
  previewShape?: PostgresExperimentObjectTypeShape;
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

function PostgresExperimentRelationshipLineShapePicker(props: {
  value: PostgresExperimentRelationshipLineShape | "";
  onChange: (value: PostgresExperimentRelationshipLineShape | "") => void;
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
                strokeDasharray={getPostgresExperimentRelationshipStrokeDasharray(option.value)}
              />
            </svg>
          </div>
          <span className="shape-picker-label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function PostgresExperimentRelationshipLineWeightPicker(props: {
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
                strokeWidth={getPostgresExperimentRelationshipStrokeWidth(option.value)}
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

function PostgresExperimentRelationshipArrowheadPicker(props: {
  value: PostgresExperimentRelationshipArrowhead | "";
  onChange: (value: PostgresExperimentRelationshipArrowhead | "") => void;
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

function PostgresExperimentObjectTypeRestrictionPicker(props: {
  value: string[];
  onChange: (value: string[]) => void;
  objectTypes: PostgresExperimentObjectType[];
  emptyLabel: string;
}) {
  const { value, onChange, objectTypes, emptyLabel } = props;
  const selected = new Set(value);
  return (
    <div
      style={{
        display: "grid",
        gap: 8,
        padding: 12,
        borderRadius: 16,
        border: "1px solid rgba(53, 80, 112, 0.16)",
        background: "linear-gradient(180deg, rgba(53, 80, 112, 0.04), rgba(255, 255, 255, 0.96))",
      }}
    >
      <button
        type="button"
        className="btn"
        onClick={() => onChange([])}
        style={{ justifySelf: "start" }}
      >
        {emptyLabel}
      </button>
      <div style={{ display: "grid", gap: 8 }}>
        {objectTypes.map((objectType) => (
          <label
            key={objectType.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              borderRadius: 12,
              border: `1px solid ${selected.has(objectType.id) ? hexToRgba(normalizePostgresExperimentObjectTypeColor(objectType.color), 0.42) : "rgba(53, 80, 112, 0.14)"}`,
              background: selected.has(objectType.id)
                ? `linear-gradient(180deg, ${hexToRgba(normalizePostgresExperimentObjectTypeColor(objectType.color), 0.12)}, rgba(255, 255, 255, 0.96))`
                : "rgba(255, 255, 255, 0.92)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={selected.has(objectType.id)}
              onChange={(event) => {
                if (event.target.checked) {
                  onChange([...value, objectType.id]);
                  return;
                }
                onChange(value.filter((id) => id !== objectType.id));
              }}
            />
            <span style={{ fontWeight: 600, color: "#1f2933" }}>{objectType.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function getPostgresExperimentRelationshipStrokeDasharray(lineShape: PostgresExperimentRelationshipLineShape): string | undefined {
  if (lineShape === "dashed") return "8 6";
  if (lineShape === "dotted") return "2 6";
  return undefined;
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = normalizePostgresExperimentObjectTypeColor(hex);
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getCanvasNodeTextColor(hex: string): string {
  const normalized = normalizePostgresExperimentObjectTypeColor(hex);
  const red = Number.parseInt(normalized.slice(1, 3), 16) / 255;
  const green = Number.parseInt(normalized.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(normalized.slice(5, 7), 16) / 255;
  const luminance = (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
  return luminance > 0.65 ? "#1f2933" : "#f8fafc";
}

function getPostgresExperimentObjectSurfaceStyle(
  color: string,
  fill: PostgresExperimentObjectFill,
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

const CANVAS_NODE_SHAPE_CONFIGS: Record<PostgresExperimentObjectTypeShape, CanvasNodeShapeConfig> = {
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

function getCanvasNodeShapeConfig(shape: PostgresExperimentObjectTypeShape): CanvasNodeShapeConfig {
  return CANVAS_NODE_SHAPE_CONFIGS[shape] ?? CANVAS_NODE_SHAPE_CONFIGS.rounded;
}

function getObjectShapePreviewStyle(shape: PostgresExperimentObjectTypeShape): {
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

function getCanvasNodeDefaultDimensions(shape: PostgresExperimentObjectTypeShape): {
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
  shape: PostgresExperimentObjectTypeShape,
  _nodeState?: Pick<PostgresExperimentCanvasNodeState, "width" | "height"> | null,
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

function getSvgShapePoints(shape: PostgresExperimentObjectTypeShape, width: number, height: number): string | null {
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
  shape: PostgresExperimentObjectTypeShape,
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
  shape: PostgresExperimentObjectTypeShape,
  width: number,
  height: number,
  color: string,
  fill: PostgresExperimentObjectFill,
  sourceVisualKey: PostgresExperimentSourceObjectVisualKey | null = null,
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

function getCanvasSketchShapeType(shape: PostgresExperimentCanvasShape): PostgresExperimentCanvasDisplayShape {
  if (shape.kind === "shape") return shape.shape;
  return "rectangle";
}

function getCanvasSketchShapeFill(
  shape: Extract<PostgresExperimentCanvasShape, { kind: "rectangle" | "shape" }>,
): PostgresExperimentObjectFill {
  return shape.fill === "outline" ? "outline" : "filled";
}

function getCanvasSketchLineStyle(
  shape: Extract<PostgresExperimentCanvasShape, { kind: "pen" | "rectangle" | "shape" }>,
): PostgresExperimentRelationshipLineShape {
  return normalizePostgresExperimentRelationshipLineShape(shape.lineStyle ?? "");
}

function formatCanvasSketchShapeLabel(shape: PostgresExperimentCanvasDisplayShape): string {
  return formatPostgresExperimentObjectShapeLabel(shape);
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

function normalizeCanvasTextHtml(html: string): string {
  const trimmed = html.trim();
  return trimmed ? html : "<div>Text</div>";
}

function renderCanvasTextForeignObjectSvg(
  shape: Extract<PostgresExperimentCanvasShape, { kind: "text" }>,
  minX: number,
  minY: number,
): string {
  const x = shape.x - minX;
  const y = shape.y - minY;
  const html = normalizeCanvasTextHtml(shape.html);
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

function CanvasRichTextEditor(props: {
  shape: Extract<PostgresExperimentCanvasShape, { kind: "text" }>;
  canvasScale: number;
  isReadOnly: boolean;
  canvasTool: PostgresExperimentCanvasTool;
  onBeginMove: (event: React.PointerEvent<Element>, shape: PostgresExperimentCanvasShape) => void;
  onBeginEditing: (shapeId: string) => void;
  onDelete: (shapeId: string) => void;
  onSelect: () => void;
  onUpdate: (
    updater: (
      shape: Extract<PostgresExperimentCanvasShape, { kind: "text" }>,
    ) => Extract<PostgresExperimentCanvasShape, { kind: "text" }>,
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
                    const nextColor = normalizePostgresExperimentObjectTypeColor(event.target.value);
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
}

function renderCanvasSketchShapeElement(
  shape: Extract<PostgresExperimentCanvasShape, { kind: "rectangle" | "shape" }>,
  selected: boolean,
) {
  const stroke = selected ? "#d62828" : shape.color;
  const strokeWidth = selected ? shape.strokeWidth + 1 : shape.strokeWidth;
  const strokeDasharray = getPostgresExperimentRelationshipStrokeDasharray(getCanvasSketchLineStyle(shape));
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

function getCanvasShapeBounds(shape: PostgresExperimentCanvasShape): {
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
  shape: PostgresExperimentCanvasShape,
  deltaX: number,
  deltaY: number,
): PostgresExperimentCanvasShape {
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
  point: PostgresExperimentCanvasPoint,
  start: PostgresExperimentCanvasPoint,
  end: PostgresExperimentCanvasPoint,
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
  shape: PostgresExperimentCanvasShape,
  point: PostgresExperimentCanvasPoint,
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
  shape: Extract<PostgresExperimentCanvasShape, { kind: "rectangle" | "shape" | "text" }>,
  handle: "nw" | "ne" | "sw" | "se",
  currentX: number,
  currentY: number,
): Extract<PostgresExperimentCanvasShape, { kind: "rectangle" | "shape" | "text" }> {
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
  shape: PostgresExperimentCanvasShape,
  minX: number,
  minY: number,
  mode: "screen" | "pdf" = "screen",
): string {
  if (shape.kind === "pen") {
    const strokeDasharray = getPostgresExperimentRelationshipStrokeDasharray(getCanvasSketchLineStyle(shape));
    return `<polyline points="${shape.points.map((point: PostgresExperimentCanvasPoint) => `${point.x - minX},${point.y - minY}`).join(" ")}" fill="none" stroke="${shape.color}" stroke-width="${shape.strokeWidth}"${strokeDasharray ? ` stroke-dasharray="${strokeDasharray}"` : ""} stroke-linecap="round" stroke-linejoin="round" />`;
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
  const strokeDasharray = getPostgresExperimentRelationshipStrokeDasharray(getCanvasSketchLineStyle(shape));
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
  shape: PostgresExperimentObjectTypeShape;
  fill: PostgresExperimentObjectFill;
  color: string;
  sourceVisualKey?: PostgresExperimentSourceObjectVisualKey | null;
  width: number;
  minHeight: number;
  selected?: boolean;
  style?: React.CSSProperties;
}) {
  const { shape, fill, color, sourceVisualKey = null, width, minHeight, selected = false, style } = props;
  const surfaceStyle = getPostgresExperimentObjectSurfaceStyle(color, fill, selected);
  const sourceOutlineAsset = sourceVisualKey ? POSTGRES_SOURCE_OBJECT_SHAPE_ASSET_URLS[sourceVisualKey] : null;
  const shapeAssets = sourceVisualKey ? null : POSTGRES_OBJECT_SHAPE_ASSET_URLS[shape];

  return (
    <span
      aria-hidden="true"
      style={{
        position: "relative",
        display: "inline-flex",
        width,
        height: minHeight,
        overflow: "hidden",
        flexShrink: 0,
        verticalAlign: "middle",
        lineHeight: 0,
        ...style,
      }}
    >
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
    </span>
  );
}

type PostgresExperimentCanvasCytoscapeNodeData = {
  color: string;
  backgroundColor: string;
  backgroundOpacity: number;
  borderWidth: number;
  shadowColor: string;
  shadowOpacity: number;
  fill: PostgresExperimentObjectFill;
  shape: PostgresExperimentObjectTypeShape;
  textColor: string;
  textMaxWidth: number;
  width: number;
  height: number;
  label: string;
};

function getPostgresExperimentCanvasCytoscapeShape(shape: PostgresExperimentObjectTypeShape): string {
  switch (shape) {
    case "rounded":
      return "ellipse";
    case "rectangle":
      return "rectangle";
    case "triangle":
      return "triangle";
    case "diamond":
      return "diamond";
    case "hexagon":
      return "hexagon";
    case "octagon":
      return "octagon";
    case "tag":
      return "tag";
    case "star":
      return "star";
    case "parallelogram":
    case "trapezoid":
      return "polygon";
    default:
      return "rectangle";
  }
}

function getPostgresExperimentCanvasCytoscapePolygonPoints(shape: PostgresExperimentObjectTypeShape): string {
  switch (shape) {
    case "parallelogram":
      return "-0.72 -1 1 -1 0.72 1 -1 1";
    case "trapezoid":
      return "-0.56 -1 0.56 -1 1 1 -1 1";
    default:
      return "-1 -1 1 -1 1 1 -1 1";
  }
}

function getPostgresExperimentCanvasNodeLabel(object: PostgresExperimentObject): string {
  const title = object.title.trim() || "Untitled object";
  const objectType = object.objectType.trim();
  return objectType ? `${title}\n${objectType}` : title;
}

function formatCanvasToolLabel(tool: PostgresExperimentCanvasTool): string {
  switch (tool) {
    case "select":
      return "Select";
    case "hand":
      return "Pan";
    case "connect":
      return "Connect";
    case "pen":
      return "Draw";
    case "shape":
      return "Shapes";
    case "text":
      return "Text";
    case "eraser":
      return "Eraser";
    default:
      return tool;
  }
}

function getCanvasToolButtonMeta(tool: PostgresExperimentCanvasTool): {
  icon: string;
  label: string;
  hint: string;
} {
  switch (tool) {
    case "select":
      return { icon: "\u2196", label: "Select", hint: "Move and inspect objects" };
    case "hand":
      return { icon: "\u2725", label: "Pan", hint: "Move around the canvas" };
    case "connect":
      return { icon: "\u21c4", label: "Connect", hint: "Create relationships" };
    case "pen":
      return { icon: "\u223f", label: "Draw", hint: "Sketch freehand notes" };
    case "shape":
      return { icon: "\u2b21", label: "Shapes", hint: "Draw geometric callouts" };
    case "text":
      return { icon: "T", label: "Text", hint: "Add canvas text notes" };
    case "eraser":
      return { icon: "\u232b", label: "Erase", hint: "Remove canvas items" };
    default:
      return { icon: "\u2022", label: formatCanvasToolLabel(tool), hint: "" };
  }
}

function getPostgresExperimentCanvasTextMaxWidth(
  shape: PostgresExperimentObjectTypeShape,
  width: number,
): number {
  switch (shape) {
    case "triangle":
      return Math.floor(width * 0.5);
    case "diamond":
      return Math.floor(width * 0.48);
    case "star":
      return Math.floor(width * 0.46);
    case "tag":
      return Math.floor(width * 0.58);
    case "hexagon":
    case "octagon":
      return Math.floor(width * 0.62);
    case "parallelogram":
    case "trapezoid":
      return Math.floor(width * 0.6);
    default:
      return Math.floor(width * 0.72);
  }
}

function buildPostgresExperimentCanvasCytoscapeElements(
  objects: PostgresExperimentObject[],
  nodeStates: Record<string, PostgresExperimentCanvasNodeState>,
  objectTypeById: Map<string, PostgresExperimentObjectType>,
  relationships: PostgresExperimentRelationship[],
  relationshipTypes: PostgresExperimentRelationshipType[],
  hiddenRelationshipIds: string[],
): ElementDefinition[] {
  const visibleNodeIds = new Set(Object.keys(nodeStates));
  const nodes = objects.reduce<ElementDefinition[]>((elements, object) => {
    const nodeState = nodeStates[object.id];
    if (!nodeState) return elements;
    const objectTypeRecord = objectTypeById.get(object.objectTypeId) ?? null;
    const appearance = getPostgresExperimentObjectAppearance(object, objectTypeRecord);
    const surface = getPostgresExperimentObjectSurfaceStyle(appearance.color, appearance.fill, false);
    const { width, height } = getCanvasNodeRenderedDimensions(appearance.shape, nodeState);
    const isFilled = appearance.fill === "filled";

    elements.push({
      group: "nodes",
      data: {
        id: object.id,
        color: appearance.color,
        backgroundColor: appearance.color,
        backgroundOpacity: isFilled ? 1 : 0,
        borderWidth: isFilled ? 2 : 3,
        shadowColor: appearance.color,
        shadowOpacity: isFilled ? 0.18 : 0.1,
        fill: appearance.fill,
        shape: appearance.shape,
        textColor: surface.textColor,
        textMaxWidth: Math.max(72, getPostgresExperimentCanvasTextMaxWidth(appearance.shape, width)),
        width,
        height,
        label: getPostgresExperimentCanvasNodeLabel(object),
      } satisfies PostgresExperimentCanvasCytoscapeNodeData & { id: string },
      position: { x: nodeState.x + width / 2, y: nodeState.y + height / 2 },
      classes: `canvas-object canvas-object--${appearance.shape}`,
    });
    return elements;
  }, []);

  const edges = relationships
    .filter((relationship) =>
      !hiddenRelationshipIds.includes(relationship.id)
      && visibleNodeIds.has(relationship.fromObjectId)
      && visibleNodeIds.has(relationship.toObjectId),
    )
    .map((relationship) => {
      const relationshipTypeRecord = relationshipTypes.find(
        (relationshipType) => relationshipType.id === relationship.relationshipTypeId,
      ) ?? null;
      const appearance = getPostgresExperimentRelationshipAppearance(relationship, relationshipTypeRecord);
      return {
        group: "edges",
        data: {
          id: relationship.id,
          source: relationship.fromObjectId,
          target: relationship.toObjectId,
          label: relationship.relationshipType,
          color: appearance.color,
          strokeWidth: getPostgresExperimentRelationshipStrokeWidth(appearance.lineWeight),
          lineStyle: appearance.lineShape === "dashed"
            ? "dashed"
            : appearance.lineShape === "dotted"
              ? "dotted"
              : "solid",
          targetArrow: appearance.arrowhead === "none" ? "none" : "triangle",
          sourceArrow: appearance.arrowhead === "double_sided" ? "triangle" : "none",
        },
        classes: "canvas-relationship",
      } satisfies ElementDefinition;
    });

  return [...nodes, ...edges];
}

const POSTGRES_EXPERIMENT_CYTOSCAPE_STYLESHEET = [
  {
    selector: "node.canvas-object",
    style: {
      shape: (element: { data: (key: string) => string }) => getPostgresExperimentCanvasCytoscapeShape(element.data("shape") as PostgresExperimentObjectTypeShape),
      "shape-polygon-points": (element: { data: (key: string) => string }) => getPostgresExperimentCanvasCytoscapePolygonPoints(element.data("shape") as PostgresExperimentObjectTypeShape),
      width: (element: { data: (key: string) => number }) => element.data("width"),
      height: (element: { data: (key: string) => number }) => element.data("height"),
      "background-color": (element: { data: (key: string) => string | number }) => String(element.data("backgroundColor")),
      "background-opacity": (element: { data: (key: string) => string | number }) => Number(element.data("backgroundOpacity")),
      "border-width": (element: { data: (key: string) => string | number }) => Number(element.data("borderWidth")),
      "border-color": (element: { data: (key: string) => string }) => element.data("color"),
      "border-style": "solid",
      label: (element: { data: (key: string) => string }) => element.data("label"),
      color: (element: { data: (key: string) => string }) => element.data("textColor"),
      "font-size": 14,
      "font-weight": 700,
      "text-wrap": "wrap",
      "text-max-width": (element: { data: (key: string) => number }) => `${element.data("textMaxWidth")}px`,
      "text-halign": "center",
      "text-valign": "center",
      "text-justification": "center",
      "line-height": 1.16,
      "text-margin-y": 2,
      "text-events": "no",
      "shadow-blur": 18,
      "shadow-offset-x": 0,
      "shadow-offset-y": 8,
      "shadow-color": (element: { data: (key: string) => string }) => element.data("shadowColor"),
      "shadow-opacity": (element: { data: (key: string) => number }) => element.data("shadowOpacity"),
      "transition-property": "border-color, border-width, shadow-opacity, outline-opacity",
      "transition-duration": "120ms",
      "overlay-opacity": 0,
      "active-bg-opacity": 0,
      "active-bg-size": 0,
    },
  },
  {
    selector: "node.canvas-object:selected",
    style: {
      "outline-width": 8,
      "outline-color": "rgba(59, 130, 246, 0.28)",
      "outline-opacity": 1,
      "outline-offset": 2,
      "border-width": 4,
      "shadow-opacity": 0.24,
    },
  },
  {
    selector: "node.canvas-object.connect-source",
    style: {
      "outline-width": 10,
      "outline-color": "rgba(16, 185, 129, 0.28)",
      "outline-opacity": 1,
      "outline-offset": 3,
      "border-color": "#0f766e",
      "shadow-opacity": 0.24,
    },
  },
  {
    selector: "node.canvas-object.connect-valid-target",
    style: {
      "outline-width": 8,
      "outline-color": "rgba(16, 185, 129, 0.22)",
      "outline-opacity": 1,
      "outline-offset": 2,
    },
  },
  {
    selector: "node.canvas-object.connect-invalid-target",
    style: {
      opacity: 0.58,
    },
  },
  {
    selector: "edge.canvas-relationship",
    style: {
      width: (element: { data: (key: string) => number }) => element.data("strokeWidth"),
      "line-style": (element: { data: (key: string) => string }) => element.data("lineStyle"),
      "line-color": (element: { data: (key: string) => string }) => element.data("color"),
      "target-arrow-color": (element: { data: (key: string) => string }) => element.data("color"),
      "source-arrow-color": (element: { data: (key: string) => string }) => element.data("color"),
      "target-arrow-shape": (element: { data: (key: string) => string }) => element.data("targetArrow"),
      "source-arrow-shape": (element: { data: (key: string) => string }) => element.data("sourceArrow"),
      "curve-style": "bezier",
      "source-endpoint": "outside-to-node",
      "target-endpoint": "outside-to-node",
      label: (element: { data: (key: string) => string }) => element.data("label"),
      color: (element: { data: (key: string) => string }) => element.data("color"),
      "font-size": 12,
      "font-weight": 700,
      "text-background-color": "#ffffff",
      "text-background-opacity": 0.92,
      "text-background-shape": "roundrectangle",
      "text-background-padding": 4,
      "text-margin-y": -8,
      "text-opacity": 0,
      "arrow-scale": 1.05,
      "overlay-opacity": 0,
      "transition-property": "line-color, width, underlay-opacity",
      "transition-duration": "120ms",
      "active-bg-opacity": 0,
      "active-bg-size": 0,
    },
  },
  {
    selector: "edge.canvas-relationship:selected",
    style: {
      "underlay-color": "rgba(59, 130, 246, 0.22)",
      "underlay-opacity": 1,
      "underlay-padding": 9,
      width: (element: { data: (key: string) => number }) => Number(element.data("strokeWidth")) + 1,
    },
  },
] as unknown as StylesheetJson;

async function computePostgresExperimentCanvasAutoLayout({
  mode,
  objects,
  objectTypes,
  relationships,
  canvasNodes,
  hiddenRelationshipIds,
}: {
  mode: PostgresExperimentCanvasAutoLayoutMode;
  objects: PostgresExperimentObject[];
  objectTypes: PostgresExperimentObjectType[];
  relationships: PostgresExperimentRelationship[];
  canvasNodes: Record<string, PostgresExperimentCanvasNodeState>;
  hiddenRelationshipIds: string[];
}): Promise<Record<string, PostgresExperimentCanvasNodeState>> {
  const visibleNodeIds = new Set(Object.keys(canvasNodes));
  if (!visibleNodeIds.size) return canvasNodes;
  const objectTypeById = new Map(objectTypes.map((objectType) => [objectType.id, objectType]));

  const layout = await postgresExperimentExploreElk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": mode,
      "elk.direction": "RIGHT",
      "elk.layered.spacing.nodeNodeBetweenLayers": "72",
      "elk.spacing.nodeNode": "40",
      "elk.padding": "[top=32,left=32,bottom=32,right=32]",
    },
    children: objects
      .filter((object) => visibleNodeIds.has(object.id))
      .map((object) => {
        const nodeState = canvasNodes[object.id];
        const objectTypeRecord = objectTypeById.get(object.objectTypeId) ?? null;
        const appearance = getPostgresExperimentObjectAppearance(object, objectTypeRecord);
        const dimensions = getCanvasNodeRenderedDimensions(appearance.shape, nodeState);
        return {
          id: object.id,
          width: dimensions.width,
          height: dimensions.height,
        };
      }),
    edges: relationships
      .filter((relationship) =>
        !hiddenRelationshipIds.includes(relationship.id)
        && visibleNodeIds.has(relationship.fromObjectId)
        && visibleNodeIds.has(relationship.toObjectId),
      )
      .map((relationship) => ({
        id: relationship.id,
        sources: [relationship.fromObjectId],
        targets: [relationship.toObjectId],
      })),
  });

  const nextNodes = { ...canvasNodes };
  for (const child of layout.children ?? []) {
    if (!child.id || !nextNodes[child.id]) continue;
    nextNodes[child.id] = {
      ...nextNodes[child.id],
      x: typeof child.x === "number" ? child.x : nextNodes[child.id].x,
      y: typeof child.y === "number" ? child.y : nextNodes[child.id].y,
      width: typeof child.width === "number" ? child.width : nextNodes[child.id].width,
      height: typeof child.height === "number" ? child.height : nextNodes[child.id].height,
    };
  }

  return nextNodes;
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

function formatPostgresExperimentAttributeDisplay(
  value: string,
  dataType: PostgresExperimentObjectAttributeDefinition["dataType"],
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
  left: Record<string, PostgresExperimentCanvasNodeState>,
  right: Record<string, PostgresExperimentCanvasNodeState>,
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

function formatPostgresExperimentDateTime(iso: string): string {
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

type PostgresExperimentSavedCanvasSession = {
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

function PostgresExperimentStatCard({
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

type AppErrorBoundaryState = {
  errorMessage: string | null;
  componentStack: string;
};

type AppErrorBoundaryCopy = {
  title: string;
  body: string;
  stackTitle: string;
  reload: string;
  reset: string;
};

class AppErrorBoundary extends Component<{ children: ReactNode; copy: AppErrorBoundaryCopy }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    errorMessage: null,
    componentStack: "",
  };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return {
      errorMessage: describeUnknownError(error),
      componentStack: "",
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("App render failed:", error, info);
    this.setState({
      errorMessage: describeUnknownError(error),
      componentStack: info.componentStack ?? "",
    });
  }

  private resetUiState() {
    if (typeof window === "undefined") return;

    sessionStorage.removeItem("kanqual:open-app-settings-modal");
    sessionStorage.removeItem("kanqual:open-project-settings-modal");
    sessionStorage.removeItem("kanqual:open-project-users-tab");

    try {
      const raw = localStorage.getItem(APP_SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { ui?: { locale?: string } };
        localStorage.setItem(
          APP_SETTINGS_KEY,
          JSON.stringify({
            ...parsed,
            ui: {
              ...parsed.ui,
              locale: "en",
            },
          }),
        );
      }
    } catch (error) {
      console.warn("Failed to reset app locale after render crash:", error);
    }
  }

  render() {
    if (!this.state.errorMessage) {
      return this.props.children;
    }

    return (
      <div className="auth-screen">
        <div className="auth-card" style={{ maxWidth: 760 }}>
          <div className="auth-brand">Kanqual</div>
          <h2 className="auth-panel-title">{this.props.copy.title}</h2>
          <p className="auth-hint">{this.props.copy.body}</p>
          <p className="auth-error">{this.state.errorMessage}</p>
          {this.state.componentStack ? (
            <pre className="settings-code-line" style={{ whiteSpace: "pre-wrap" }}>
              {this.props.copy.stackTitle}
              {"\n"}
              {this.state.componentStack.trim()}
            </pre>
          ) : null}
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => window.location.reload()}>
              {this.props.copy.reload}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                this.resetUiState();
                window.location.reload();
              }}
            >
              {this.props.copy.reset}
            </button>
          </div>
        </div>
      </div>
    );
  }
}

function AppErrorBoundaryWithI18n({ children }: { children: ReactNode }) {
  const { t } = useI18n();

  return (
    <AppErrorBoundary
      copy={{
        title: t("app.errorBoundary.title"),
        body: t("app.errorBoundary.body"),
        stackTitle: t("app.errorBoundary.stackTitle"),
        reload: t("app.errorBoundary.reload"),
        reset: t("app.errorBoundary.reset"),
      }}
    >
      {children}
    </AppErrorBoundary>
  );
}

const ProjectsViewLazy = lazyView(() => import("./views/Projects_View").then((m) => ({ default: m.ProjectsView })));
const HomeViewLazy = lazyView(() => import("./views/Project_Home_View").then((m) => ({ default: m.HomeView })));
const UsersViewLazy = lazyView(() => import("./views/Project_Users_View").then((m) => ({ default: m.UsersView })));
const CasesViewLazy = lazyView(() => import("./views/Project_Cases_View").then((m) => ({ default: m.CasesView })));
const DocumentsViewLazy = lazyView(() => import("./views/Project_Documents_View").then((m) => ({ default: m.DocumentsView })));
const PostgresProjectSourcesViewLazy = lazy(
  () => import("./views/Postgres_Project_Sources_View").then((m) => ({ default: m.PostgresProjectSourcesView })),
);
const PostgresAnalysisCodeSourcesViewLazy = lazy(
  () => import("./views/Postgres_Analysis_Code_Sources_View").then((m) => ({ default: m.PostgresAnalysisCodeSourcesView })),
);
const PostgresMemosViewLazy = lazy(
  () => import("./views/Postgres_Memos_View").then((m) => ({ default: m.PostgresMemosView })),
);
const PostgresProjectLogViewLazy = lazy(
  () => import("./views/Postgres_Project_Log_View").then((m) => ({ default: m.PostgresProjectLogView })),
);
const CodebookViewLazy = lazy(
  () => import("./views/Project_Codebook_View").then((m) => ({
    default: m.CodebookView as ComponentType<import("./views/Project_Codebook_View").CodebookViewProps>,
  })),
);
const AnnotationsViewLazy = lazy(
  () => import("./views/Project_Annotations_View").then((m) => ({
    default: m.AnnotationsView as ComponentType<import("./views/Project_Annotations_View").AnnotationsViewProps>,
  })),
);
const ProjectSettingsViewLazy = lazyView(() => import("./views/Project_Settings_View").then((m) => ({ default: m.ProjectSettingsView })));
const CodeTextViewLazy = lazyView(() => import("./views/Analysis_Code_View").then((m) => ({ default: m.CodeTextView })));
const MemosViewLazy = lazyView(() => import("./views/Analysis_Memos_View").then((m) => ({ default: m.MemosView })));
const AIAssistViewLazy = lazyView(() => import("./views/AIAssist_Home_View").then((m) => ({ default: m.AIAssistView })));
const AIAssistChatViewLazy = lazyView(() => import("./views/AIAssist_Chat_View").then((m) => ({ default: m.AIAssistChatView })));
const AIAssistProcessDocumentsViewLazy = lazyView(() => import("./views/AIAssist_ProcessDocuments_View").then((m) => ({ default: m.AIAssistProcessDocumentsView })));
const AIAssistProcessDocumentsReviewViewLazy = lazyView(() => import("./views/AIAssist_ProcessDocuments_Review_View").then((m) => ({ default: m.AIAssistProcessDocumentsReviewView })));
const AIAssistedCodingViewLazy = lazyView(() => import("./views/AIAssist_Code_View").then((m) => ({ default: m.AIAssistedCodingView })));
const AIAssistAttributeCaseViewLazy = lazyView(() => import("./views/AIAssist_Attributes_View").then((m) => ({ default: m.AIAssistAttributeCaseView })));
const AIAssistAttributeDocumentViewLazy = lazyView(() => import("./views/AIAssist_Attributes_View").then((m) => ({ default: m.AIAssistAttributeDocumentView })));
const AIAnalyzeViewLazy = lazyView(() => import("./views/AIAssist_Analyze_View").then((m) => ({ default: m.AIAnalyzeView })));
const CodeReportsViewLazy = lazyView(() => import("./views/Reports_Annotations_View").then((m) => ({ default: m.CodeReportsView })));
const CodesViewLazy = lazyView(() => import("./views/Reports_Codes_View").then((m) => ({ default: m.CodesView })));
const ReportsUsersViewLazy = lazyView(() => import("./views/Reports_Users_View").then((m) => ({ default: m.ReportsUsersView })));
const ProjectLogViewLazy = lazyView(() => import("./views/Project_Log_View").then((m) => ({ default: m.ProjectLogView })));
const UserSettingsViewLazy = lazyView(() => import("./views/User_Settings_View").then((m) => ({ default: m.UserSettingsView })));
const AppSettingsViewLazy = lazyView(() => import("./views/App_Settings_View").then((m) => ({ default: m.AppSettingsView })));

const VIEW_COMPONENTS = {
  projects: ProjectsViewLazy,
  home: HomeViewLazy,
  users: UsersViewLazy,
  cases: CasesViewLazy,
  documents: DocumentsViewLazy,
  codebook: CodebookViewLazy,
  annotations: AnnotationsViewLazy,
  "project-settings": ProjectSettingsViewLazy,
  "code-text": CodeTextViewLazy,
  memos: MemosViewLazy,
  "ai-assist": AIAssistViewLazy,
  "ai-assist-chat": AIAssistChatViewLazy,
  "ai-assist-process-documents": AIAssistProcessDocumentsViewLazy,
  "ai-assist-process-documents-review": AIAssistProcessDocumentsReviewViewLazy,
  "ai-assisted-coding": AIAssistedCodingViewLazy,
  "ai-assist-case-attributes": AIAssistAttributeCaseViewLazy,
  "ai-assist-document-attributes": AIAssistAttributeDocumentViewLazy,
  "ai-analyze": AIAnalyzeViewLazy,
  "code-reports": CodeReportsViewLazy,
  codes: CodesViewLazy,
  coders: ReportsUsersViewLazy,
  "project-log": ProjectLogViewLazy,
  "user-settings": UserSettingsViewLazy,
  "app-settings": AppSettingsViewLazy,
} as const;

function formatDurationEstimate(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.max(1, Math.round((seconds % 3600) / 60));
  return `${hours} hr ${minutes} min`;
}

function formatGigabytes(value: number): string {
  return `${(value / (1024 ** 3)).toFixed(2)} GB`;
}

function formatPercent(value: number | null): string {
  return value == null ? "--" : `${Math.max(0, Math.min(100, value)).toFixed(0)}%`;
}

type ReleaseCheckResult = {
  latestVersion: string;
  releaseUrl: string;
};

const UPDATE_RELEASES_URL = "https://github.com/KanQual/kanqual/releases";

function normalizeSemver(version: string): number[] {
  const clean = version.trim().replace(/^v/i, "").split("-")[0];
  const parts = clean.split(".").map((part) => Number.parseInt(part, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function compareSemver(a: string, b: string): number {
  const left = normalizeSemver(a);
  const right = normalizeSemver(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function fetchLatestRelease(): Promise<ReleaseCheckResult | null> {
  const response = await fetch("https://api.github.com/repos/KanQual/kanqual/releases/latest", {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub release check failed with status ${response.status}.`);
  const release = await response.json() as Record<string, unknown>;
  if (typeof release.tag_name !== "string") return null;
  return {
    latestVersion: release.tag_name,
    releaseUrl: typeof release.html_url === "string" ? release.html_url : UPDATE_RELEASES_URL,
  };
}

function UpdateAvailableBanner({
  version,
  releaseUrl,
  onDismiss,
}: {
  version: string;
  releaseUrl: string;
  onDismiss: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="embedding-build-banner embedding-build-banner--completed">
      <div className="embedding-build-banner-copy">
        <strong>{t("app.updateBanner.title")}</strong>
        <span>{t("app.updateBanner.versionBody", { version })}</span>
        <span>{t("app.updateBanner.detail")}</span>
      </div>
      <div className="embedding-build-banner-actions">
        <a
          className="btn btn--primary"
          href={releaseUrl}
          target="_blank"
          rel="noreferrer"
        >
          {t("app.updateBanner.viewRelease")}
        </a>
        <button type="button" className="btn" onClick={onDismiss}>
          {t("common.dismiss")}
        </button>
      </div>
    </div>
  );
}

function ProjectBackupBanner() {
  const { t } = useI18n();
  const { activeProject, canCurrentUser, setView } = useStore();
  const [issue, setIssue] = useState<ProjectBackupBannerIssue | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refreshBackupBanner() {
      if (
        !activeProject
        || !(canCurrentUser("manageBackupsAndRestores")
          || canCurrentUser("exportProject")
          || canCurrentUser("restoreProjectBackup"))
      ) {
        if (!cancelled) setIssue(null);
        return;
      }

      const nextIssue = await loadProjectBackupBannerIssue(activeProject);
      if (!cancelled) setIssue(nextIssue);
    }

    void refreshBackupBanner();

    function handleBackupsChanged(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail as { projectId?: string } | undefined : undefined;
      if (detail?.projectId && activeProject && detail.projectId !== activeProject.id) return;
      void refreshBackupBanner();
    }

    window.addEventListener(PROJECT_BACKUPS_CHANGED_EVENT, handleBackupsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(PROJECT_BACKUPS_CHANGED_EVENT, handleBackupsChanged);
    };
  }, [activeProject, canCurrentUser]);

  if (!activeProject || !issue) return null;

  const toneClass = issue.kind === "failed" ? "embedding-build-banner--error" : "embedding-build-banner--warning";
  const bannerCopy =
    issue.kind === "failed"
      ? {
          title: t("app.backupBanner.failedTitle"),
          detail: t("app.backupBanner.failedDetail"),
          actionLabel: t("app.backupBanner.failedAction"),
        }
      : issue.kind === "interrupted"
        ? {
            title: t("app.backupBanner.interruptedTitle"),
            detail: t("app.backupBanner.interruptedDetail"),
            actionLabel: t("app.backupBanner.interruptedAction"),
          }
        : {
            title: t("app.backupBanner.missingTitle"),
            detail: t("app.backupBanner.missingDetail"),
            actionLabel: t("app.backupBanner.missingAction"),
          };

  function openBackupSettings() {
    sessionStorage.setItem("kanqual:open-project-settings-modal", "backups");
    window.dispatchEvent(new CustomEvent(OPEN_PROJECT_SETTINGS_MODAL_EVENT));
    setView("project-settings");
  }

  return (
    <div className={`embedding-build-banner ${toneClass}`}>
      <div className="embedding-build-banner-copy">
        <strong>{bannerCopy.title}</strong>
        <span>{issue.message}</span>
        <span>{bannerCopy.detail}</span>
      </div>
      <div className="embedding-build-banner-actions">
        <button type="button" className="btn btn--primary" onClick={openBackupSettings}>
          {bannerCopy.actionLabel}
        </button>
      </div>
    </div>
  );
}

function ForcePasswordChangeView() {
  const { t } = useI18n();
  const { user, changePassword, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError(t("app.forcePassword.enterTemporary"));
      return;
    }
    if (newPassword.length < 8) {
      setError(t("app.forcePassword.passwordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("app.forcePassword.passwordsDoNotMatch"));
      return;
    }
    setSaving(true);
    try {
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : t("app.forcePassword.passwordChangeFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">Kanqual</div>
        <p className="auth-tagline">{t("app.forcePassword.tagline")}</p>
        <form onSubmit={handleSubmit} className="form">
          <h2 className="auth-panel-title">{t("app.forcePassword.title")}</h2>
          <p className="auth-hint">
            {t("app.forcePassword.temporaryNotice")}
          </p>
          <p className="auth-hint">
            {t("app.forcePassword.signedInAs", { email: user?.email ?? "" })}
          </p>
          <label className="form-label">
            {t("app.forcePassword.temporaryPassword")}
            <input
              className="form-input"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
            />
          </label>
          <label className="form-label">
            {t("app.forcePassword.newPassword")}
            <input
              className="form-input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="form-label">
            {t("app.forcePassword.confirmPassword")}
            <input
              className="form-input"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          {error && <p className="auth-error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn" onClick={logout} disabled={saving}>
              {t("common.signOut")}
            </button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? t("app.forcePassword.updating") : t("app.forcePassword.setPassword")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ProjectEmbeddingBuildBanner() {
  const { t } = useI18n();
  const {
    projectEmbeddingBuildStatus,
    projectEmbeddingBuildBannerOpen,
    cancelProjectEmbeddingBuild,
    dismissProjectEmbeddingBanner,
    projects,
    activeProject,
  } = useStore();

  if (!projectEmbeddingBuildBannerOpen || !projectEmbeddingBuildStatus) return null;
  const phase = projectEmbeddingBuildStatus.phase;
  const isActive = phase === "running" || phase === "cancelling";
  const progressPercent = Math.max(0, Math.min(100, projectEmbeddingBuildStatus.progressPercent ?? 0));
  const progressFillPercent = isActive ? Math.max(8, progressPercent) : progressPercent;
  const showIndeterminateProgress = isActive && progressPercent <= 0;
  const etaSeconds =
    isActive
      && projectEmbeddingBuildStatus.startedAtMs
      && projectEmbeddingBuildStatus.completedItems > 0
      && projectEmbeddingBuildStatus.totalItems > projectEmbeddingBuildStatus.completedItems
      ? Math.max(
          1,
          Math.round(
            ((Date.now() - projectEmbeddingBuildStatus.startedAtMs) / 1000)
            / projectEmbeddingBuildStatus.completedItems
            * (projectEmbeddingBuildStatus.totalItems - projectEmbeddingBuildStatus.completedItems),
          ),
        )
      : null;
  const bannerProjectName =
    (projectEmbeddingBuildStatus.projectId
      ? projects.find((project) => project.id === projectEmbeddingBuildStatus.projectId)?.name
      : null)
    ?? (activeProject?.id === projectEmbeddingBuildStatus.projectId ? activeProject.name : null);

  return (
    <div className={`embedding-build-banner embedding-build-banner--${phase}`}>
      <div className="embedding-build-banner-copy">
        <strong>
          {phase === "running" && t("app.embeddingBuild.runningTitle")}
          {phase === "cancelling" && t("app.embeddingBuild.cancellingTitle")}
          {phase === "completed" && t("app.embeddingBuild.completedTitle")}
          {phase === "cancelled" && t("app.embeddingBuild.cancelledTitle")}
          {phase === "error" && t("app.embeddingBuild.errorTitle")}
        </strong>
        <span>
          {projectEmbeddingBuildStatus.message ??
            t("app.embeddingBuild.itemsProcessed", {
              completed: projectEmbeddingBuildStatus.completedItems,
              total: projectEmbeddingBuildStatus.totalItems,
            })}
        </span>
        {isActive && (
          <div className="embedding-build-banner-meta">
            {bannerProjectName && <span>{t("app.embeddingBuild.project", { name: bannerProjectName })}</span>}
            <span>{t("app.embeddingBuild.progress", { value: formatPercent(projectEmbeddingBuildStatus.progressPercent) })}</span>
            <span>{t("app.embeddingBuild.items", {
              completed: projectEmbeddingBuildStatus.completedItems,
              total: projectEmbeddingBuildStatus.totalItems,
            })}</span>
            <span>{t("app.embeddingBuild.eta", {
              value: etaSeconds != null ? formatDurationEstimate(etaSeconds) : t("app.embeddingBuild.estimating"),
            })}</span>
            {projectEmbeddingBuildStatus.currentLabel && (
              <span title={projectEmbeddingBuildStatus.currentLabel}>
                {t("app.embeddingBuild.current", { label: projectEmbeddingBuildStatus.currentLabel })}
              </span>
            )}
          </div>
        )}
        {isActive && (
          <div className="embedding-build-banner-progress">
            <div
              className={`model-download-progress-track${showIndeterminateProgress ? " model-download-progress-track--indeterminate" : ""}`}
              aria-hidden="true"
            >
              <div
                className="model-download-progress-fill model-download-progress-fill--active"
                style={{
                  width: showIndeterminateProgress ? "34%" : `${progressFillPercent}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>
      <div className="embedding-build-banner-actions">
        {isActive ? (
          <button type="button" className="btn" onClick={() => void cancelProjectEmbeddingBuild()}>
            {phase === "cancelling" ? t("app.embeddingBuild.cancellingAction") : t("app.embeddingBuild.cancelAction")}
          </button>
        ) : (
          <button type="button" className="btn" onClick={dismissProjectEmbeddingBanner}>
            {t("common.dismiss")}
          </button>
        )}
      </div>
    </div>
  );
}

function DocumentProcessingBanner() {
  const { t } = useI18n();
  const {
    documentProcessingStatus,
    documentProcessingBannerOpen,
    dismissDocumentProcessingBanner,
  } = useStore();

  if (!documentProcessingBannerOpen || !documentProcessingStatus) return null;
  const phase = documentProcessingStatus.phase;
  if (phase === "idle") return null;
  const isActive = phase === "running";
  const failures = documentProcessingStatus.failures ?? [];
  const progressPercent = documentProcessingStatus.totalDocuments > 0
    ? (documentProcessingStatus.completedDocuments / documentProcessingStatus.totalDocuments) * 100
    : 0;

  return (
    <div className={`embedding-build-banner embedding-build-banner--${phase}`}>
      <div className="embedding-build-banner-copy">
        <strong>
          {phase === "running" && t("app.documentProcessing.runningTitle")}
          {phase === "completed" && t("app.documentProcessing.completedTitle")}
          {phase === "error" && t("app.documentProcessing.errorTitle")}
        </strong>
        <span>{documentProcessingStatus.message}</span>
        {isActive && documentProcessingStatus.currentChunkIndex && documentProcessingStatus.currentChunkTotal && (
          <span>
            {t("app.documentProcessing.chunkProgress", {
              index: documentProcessingStatus.currentChunkIndex,
              total: documentProcessingStatus.currentChunkTotal,
            })}
          </span>
        )}
        {failures.length > 0 && (
          <div className="embedding-build-banner-meta embedding-build-banner-meta--stacked">
            {failures.map((failure, index) => (
              <span key={`${failure.documentName}-${index}`}>
                {t("app.documentProcessing.errorLine", {
                  documentName: failure.documentName,
                  message: failure.message,
                })}
              </span>
            ))}
          </div>
        )}
        {isActive && (
          <div className="embedding-build-banner-progress">
            <div className="model-download-progress-track" aria-hidden="true">
              <div
                className="model-download-progress-fill model-download-progress-fill--active"
                style={{ width: `${Math.max(6, Math.min(100, progressPercent))}%` }}
              />
            </div>
          </div>
        )}
      </div>
      <div className="embedding-build-banner-actions">
        {!isActive && (
          <button type="button" className="btn" onClick={dismissDocumentProcessingBanner}>
            {t("common.dismiss")}
          </button>
        )}
      </div>
    </div>
  );
}

function EmbeddingModelDownloadBanner() {
  const { t, formatNumber } = useI18n();
  const {
    embeddingModelDownloadStatus,
    embeddingModelDownloadPreflight,
    embeddingModelDownloadBannerOpen,
    cancelEmbeddingModelDownload,
    dismissEmbeddingModelDownloadBanner,
  } = useStore();

  if (!embeddingModelDownloadBannerOpen || !embeddingModelDownloadStatus) return null;
  const phase = embeddingModelDownloadStatus.phase;
  if (phase === "idle") return null;
  const isActive = phase === "downloading" || phase === "cancelling";
  const totalBytes = embeddingModelDownloadPreflight?.totalBytes ?? embeddingModelDownloadStatus.totalBytes ?? 0;
  const liveDownloadedBytes = isActive
    ? embeddingModelDownloadStatus.downloadedBytes
    : (embeddingModelDownloadPreflight?.existingBytes ?? embeddingModelDownloadStatus.downloadedBytes);
  const liveRemainingBytes = Math.max(0, totalBytes - liveDownloadedBytes);
  const liveRemainingFiles =
    isActive && embeddingModelDownloadStatus.totalFiles > 0
      ? Math.max(0, embeddingModelDownloadStatus.totalFiles - embeddingModelDownloadStatus.downloadedFiles)
      : embeddingModelDownloadPreflight?.remainingFiles;

  return (
    <div className={`embedding-build-banner embedding-build-banner--${phase}`}>
      <div className="embedding-build-banner-copy">
        <strong>
          {phase === "downloading" && t("app.embeddingDownload.downloadingTitle")}
          {phase === "cancelling" && t("app.embeddingDownload.cancellingTitle")}
          {phase === "completed" && t("app.embeddingDownload.completedTitle")}
          {phase === "cancelled" && t("app.embeddingDownload.cancelledTitle")}
          {phase === "error" && t("app.embeddingDownload.errorTitle")}
        </strong>
        <span>
          {embeddingModelDownloadStatus.message ??
            (embeddingModelDownloadStatus.progressPercent != null
              ? t("app.embeddingDownload.downloadedPercent", { percent: Math.round(embeddingModelDownloadStatus.progressPercent) })
              : t("app.embeddingDownload.preparing"))}
        </span>
        {embeddingModelDownloadStatus.progressPercent != null && (
          <span>{t("app.embeddingDownload.downloadProgress", { percent: Math.round(embeddingModelDownloadStatus.progressPercent) })}</span>
        )}
        {embeddingModelDownloadPreflight && (
          <>
            <span>
              {t("app.embeddingDownload.totalSize", { size: formatGigabytes(totalBytes) })}
            </span>
            <span>
              {t("app.embeddingDownload.alreadyOnDevice", { size: formatGigabytes(liveDownloadedBytes) })}
            </span>
            <span>
              {t("app.embeddingDownload.remainingToDownload", { size: formatGigabytes(liveRemainingBytes) })}
            </span>
            {(embeddingModelDownloadPreflight.manifestAvailable || isActive) &&
              liveRemainingFiles != null && (
                <span>
                  {t("app.embeddingDownload.remainingFileCount", { count: formatNumber(liveRemainingFiles) })}
                </span>
              )}
          </>
        )}
        {embeddingModelDownloadStatus.currentFile && (
          <span>{t("app.embeddingDownload.currentFile", { name: embeddingModelDownloadStatus.currentFile })}</span>
        )}
        {isActive && (
          <div className="embedding-build-banner-progress">
            <div className="model-download-progress-track" aria-hidden="true">
              <div
                className="model-download-progress-fill model-download-progress-fill--active"
                style={{
                  width: `${Math.max(
                    6,
                    Math.min(100, embeddingModelDownloadStatus.progressPercent ?? 0),
                  )}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>
      <div className="embedding-build-banner-actions">
        {isActive ? (
          <button type="button" className="btn" onClick={() => void cancelEmbeddingModelDownload()}>
            {phase === "cancelling" ? t("app.embeddingDownload.cancellingAction") : t("app.embeddingDownload.cancelAction")}
          </button>
        ) : (
          <button type="button" className="btn" onClick={dismissEmbeddingModelDownloadBanner}>
            {t("common.dismiss")}
          </button>
        )}
      </div>
    </div>
  );
}

function PostgresAdminHandoffView({
  status,
  onComplete,
}: {
  status: PostgresExperimentStatus;
  onComplete: (nextStatus: PostgresExperimentStatus) => void | Promise<void>;
}) {
  const [username, setUsername] = useState(status.superuserName);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!username.trim()) {
      setError("Enter the new PostgreSQL admin username.");
      return;
    }
    if (!password || !confirmPassword) {
      setError("Enter the new PostgreSQL admin password twice.");
      return;
    }
    if (password.length < 8) {
      setError("Choose a PostgreSQL admin password with at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The PostgreSQL admin passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      const nextStatus = await completePostgresAdminHandoff({
        newSuperuserName: username.trim(),
        newSuperuserPassword: password,
      });
      setUsername(nextStatus.superuserName);
      setPassword("");
      setConfirmPassword("");
      await onComplete(nextStatus);
    } catch (handoffError) {
      setError(handoffError instanceof Error ? handoffError.message : String(handoffError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card" style={{ maxWidth: 760 }}>
        <div className="auth-brand">Kanqual</div>
        <p className="auth-tagline">PostgreSQL Experiment</p>
        <form onSubmit={handleSubmit} className="form">
          <h2 className="auth-panel-title">Finish local database admin setup</h2>
          <p className="auth-hint">
            Kanqual has already bootstrapped the restricted app role
            {" "}
            <code>{status.appRoleName}</code>
            {" "}
            for the local database
            {" "}
            <code>{status.appDatabase}</code>
            .
          </p>
          <div className="settings-warning settings-warning--danger">
            Set the PostgreSQL administrator password now. Kanqual will not be able to recover it for you after this handoff completes.
          </div>
          <label className="form-label">
            New PostgreSQL admin username
            <input
              className="form-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
            />
          </label>
          <label className="form-label">
            New PostgreSQL admin password
            <input
              className="form-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="form-label">
            Confirm PostgreSQL admin password
            <input
              className="form-input"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          {error ? <p className="auth-error">{error}</p> : null}
          <div className="form-actions">
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? "Finalizing..." : "Finalize admin handoff"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PostgresExperimentLaunchView({
  status,
  loading,
  onRefresh,
  onBootstrap,
  onOpenPostgresProjects,
  onOpenCurrentApp,
}: {
  status: PostgresExperimentStatus | null;
  loading: boolean;
  onRefresh: () => void;
  onBootstrap: (superuserPassword: string) => Promise<void>;
  onOpenPostgresProjects: () => void;
  onOpenCurrentApp: () => void;
}) {
  const [superuserPassword, setSuperuserPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const bootstrapApplied = !!status?.bootstrapApplied;
  const adminHandoffCompleted = !!status?.adminHandoffCompleted;
  const appRoleReady = bootstrapApplied && adminHandoffCompleted;

  async function handleBootstrapSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!superuserPassword) {
      setError("Enter the current PostgreSQL superuser password to bootstrap the experiment.");
      return;
    }

    setSubmitting(true);
    try {
      await onBootstrap(superuserPassword);
      setSuperuserPassword("");
      setNotice("PostgreSQL bootstrap completed. You can continue the admin handoff on the next screen.");
    } catch (bootstrapError) {
      setError(bootstrapError instanceof Error ? bootstrapError.message : String(bootstrapError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card" style={{ maxWidth: 820 }}>
        <div className="auth-brand">Kanqual</div>
        <p className="auth-tagline">PostgreSQL Experiment</p>
        <div className="form">
          <h2 className="auth-panel-title">Local database experiment launch check</h2>
          <p className="auth-hint">
            This branch still runs the normal app against PocketBase, but PostgreSQL can now be bootstrapped and checked before the rest of the app opens.
          </p>

          <div className="settings-warning">
            <strong>Current runtime state</strong>
            <br />
            {status
              ? (status.serviceReachable
                ? `PostgreSQL is reachable at ${status.host}:${status.port}.`
                : `PostgreSQL is not reachable at ${status.host}:${status.port}.`)
              : "Loading PostgreSQL experiment status..."}
            <br />
            {status
              ? `App role: ${status.appRoleName} on database ${status.appDatabase}.`
              : "Reading planned app role and database..."}
          </div>

          {!bootstrapApplied && (
            <form onSubmit={handleBootstrapSubmit} className="form">
              <div className="settings-warning settings-warning--danger">
                Bootstrap has not been applied yet. Enter the current PostgreSQL superuser password to create the restricted app role and experiment database.
              </div>
              <label className="form-label">
                Current PostgreSQL superuser password
                <input
                  className="form-input"
                  type="password"
                  value={superuserPassword}
                  onChange={(e) => setSuperuserPassword(e.target.value)}
                  autoFocus
                  autoComplete="current-password"
                />
              </label>
              <div className="form-actions">
                <button type="button" className="btn" onClick={onRefresh} disabled={loading || submitting}>
                  Refresh status
                </button>
                <button type="submit" className="btn btn--primary" disabled={loading || submitting}>
                  {submitting ? "Bootstrapping..." : "Bootstrap PostgreSQL experiment"}
                </button>
              </div>
            </form>
          )}

          {bootstrapApplied && !adminHandoffCompleted && (
            <>
              <div className="settings-warning settings-warning--danger">
                Bootstrap is complete, but the PostgreSQL admin password handoff still needs to be finalized before this experiment is considered ready.
              </div>
              <div className="form-actions">
                <button type="button" className="btn" onClick={onRefresh} disabled={loading}>
                  Refresh status
                </button>
              </div>
            </>
          )}

          {appRoleReady && (
            <>
              <div className="settings-warning">
                <strong>Experiment ready</strong>
                <br />
                The PostgreSQL bootstrap and admin handoff are complete. The main app below still uses PocketBase until we switch individual flows over.
              </div>
              <div className="form-actions">
                <button type="button" className="btn" onClick={onRefresh} disabled={loading}>
                  Refresh status
                </button>
                <button type="button" className="btn btn--primary" onClick={onOpenPostgresProjects}>
                  Open PostgreSQL projects
                </button>
                <button type="button" className="btn" onClick={onOpenCurrentApp}>
                  Open current app
                </button>
              </div>
            </>
          )}

          {!appRoleReady && (
            <>
              <div className="form-actions">
                <button type="button" className="btn" onClick={onOpenCurrentApp}>
                  Open current app anyway
                </button>
              </div>
            </>
          )}

          {notice ? <p className="settings-success">{notice}</p> : null}
          {error ? <p className="auth-error">{error}</p> : null}

          {status ? (
            <p className="auth-hint settings-code-line">
              {status.bootstrapIdentityPath}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PostgresExperimentAuthView({
  authStatus,
  onRefresh,
  onAuthenticated,
  onOpenCurrentApp,
}: {
  authStatus: PostgresExperimentAuthStatus | null;
  onRefresh: () => Promise<void>;
  onAuthenticated: (session: PostgresExperimentAuthSession) => void;
  onOpenCurrentApp: () => void;
}) {
  const [mode, setMode] = useState<"admin" | "login" | "register">("admin");
  const [name, setName] = useState("");
  const [adminUsername, setAdminUsername] = useState("");
  const [email, setEmail] = useState("");
  const [recentAccounts, setRecentAccounts] = useState<PostgresExperimentRememberedAccount[]>([]);
  const [selectedRecentEmail, setSelectedRecentEmail] = useState("");
  const [showManualEmailEntry, setShowManualEmailEntry] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [rememberSession, setRememberSession] = useState(false);

  const effectiveMode = mode;
  const selectedRecentAccount = selectedRecentEmail
    ? recentAccounts.find((account) => account.email === selectedRecentEmail) ?? null
    : null;

  useEffect(() => {
    let cancelled = false;

    async function loadRecentAccounts() {
      try {
        const nextAccounts = await listPostgresExperimentRememberedAccounts();
        if (!cancelled) {
          setRecentAccounts(nextAccounts);
        }
      } catch (loadError) {
        if (!cancelled) {
          console.warn("Could not load remembered PostgreSQL accounts:", describeUnknownError(loadError));
        }
      }
    }

    void loadRecentAccounts();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadInstallationSettings() {
      try {
        const settings = await getPostgresExperimentInstallationSettings();
        if (!cancelled) {
          setRememberSession(settings.startupAutoLoginLastUser);
        }
      } catch (loadError) {
        if (!cancelled) {
          console.warn("Could not load PostgreSQL installation settings:", describeUnknownError(loadError));
        }
      }
    }

    void loadInstallationSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (effectiveMode === "admin") {
      if (!adminUsername.trim()) {
        setError("Enter the PostgreSQL administrator username.");
        return;
      }
      if (password.length < 8) {
        setError("Enter the PostgreSQL administrator password.");
        return;
      }
      setSubmitting(true);
      try {
        const session = await loginPostgresExperimentAdmin({
          username: adminUsername.trim(),
          password,
          rememberSession,
        });
        setPassword("");
        onAuthenticated(session);
      } catch (authError) {
        setError(describeUnknownError(authError));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();
    if (effectiveMode === "register" && !name.trim()) {
      setError("Enter your name.");
      return;
    }
    if (!trimmedEmail) {
      setError("Enter your email.");
      return;
    }
    if (password.length < 8) {
      setError("Choose a password with at least 8 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const session = effectiveMode === "register"
        ? await registerPostgresExperimentAppUser({
            name: name.trim(),
            email: trimmedEmail,
            password,
            rememberSession,
          })
        : await loginPostgresExperimentAppUser({
            email: trimmedEmail,
            password,
            rememberSession,
          });
      await rememberPostgresExperimentAccount(trimmedEmail, session.user.name || name.trim() || trimmedEmail);
      setRecentAccounts(await listPostgresExperimentRememberedAccounts());
      setPassword("");
      onAuthenticated(session);
    } catch (authError) {
      setError(describeUnknownError(authError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card" style={{ maxWidth: 720 }}>
        <div className="auth-brand">Kanqual</div>
        <p className="auth-tagline">PostgreSQL Experiment</p>

        <form onSubmit={handleSubmit} className="form">
          <h2 className="auth-panel-title">Sign in to the PostgreSQL workspace</h2>
          <p className="auth-hint">
            PostgreSQL bootstrap is complete. The local PostgreSQL administrator is now the built-in Kanqual administrator for this device.
          </p>

          <div className="auth-tabs">
            <button
              type="button"
              className={`auth-tab ${effectiveMode === "admin" ? "auth-tab--active" : ""}`}
              onClick={() => setMode("admin")}
            >
              Local administrator
            </button>
            <button
              type="button"
              className={`auth-tab ${effectiveMode === "login" ? "auth-tab--active" : ""}`}
              onClick={() => {
                setMode("login");
                setError("");
                setShowManualEmailEntry(false);
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              className={`auth-tab ${effectiveMode === "register" ? "auth-tab--active" : ""}`}
              onClick={() => {
                setMode("register");
                setSelectedRecentEmail("");
                setShowManualEmailEntry(false);
                setError("");
              }}
            >
              Create account
            </button>
          </div>

          {effectiveMode === "admin" && (
            <div className="auth-admin-notice">
              <strong>Built-in local administrator</strong>
              <span>
                Sign in with the PostgreSQL superuser account to get full access across all local PostgreSQL projects.
              </span>
            </div>
          )}

          {effectiveMode === "register" && (
            <div className="auth-admin-notice">
              <strong>Regular PostgreSQL app account</strong>
              <span>
                Accounts created here are standard Kanqual users. They are separate from the built-in PostgreSQL administrator.
              </span>
            </div>
          )}

          {effectiveMode === "register" && (
            <label className="form-label">
              Name
              <input
                className="form-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your name"
                autoFocus
              />
            </label>
          )}

          {effectiveMode === "login" && recentAccounts.length > 0 && !selectedRecentAccount && !showManualEmailEntry ? (
            <div className="form-label">
              Recent accounts
              <ul className="account-list" style={{ marginTop: 10, marginBottom: 12 }}>
                {recentAccounts.map((account) => (
                  <li
                    key={account.email}
                    className="account-item"
                    onClick={() => {
                      setEmail(account.email);
                      setSelectedRecentEmail(account.email);
                      setShowManualEmailEntry(false);
                      setPassword("");
                      setError("");
                    }}
                  >
                    <div className="account-avatar">{accountInitials(account.name)}</div>
                    <div className="account-info">
                      <div className="account-name">{account.name}</div>
                      <div className="account-email">{account.email}</div>
                    </div>
                    <div className="account-login-time">{formatRecentLogin(account.lastLogin)}</div>
                  </li>
                ))}
              </ul>
              <div className="account-list-actions" style={{ justifyContent: "flex-start", marginBottom: 8 }}>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => {
                    setEmail("");
                    setSelectedRecentEmail("");
                    setShowManualEmailEntry(true);
                    setError("");
                  }}
                >
                  Use different email
                </button>
              </div>
            </div>
          ) : null}

          {effectiveMode === "login" && selectedRecentAccount ? (
            <div className="auth-admin-notice">
              <strong>{selectedRecentAccount.name}</strong>
              <span>{selectedRecentAccount.email}</span>
              <div className="form-actions" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => {
                    setEmail("");
                    setSelectedRecentEmail("");
                    setShowManualEmailEntry(true);
                    setPassword("");
                    setError("");
                  }}
                >
                  Use different email
                </button>
              </div>
            </div>
          ) : null}

          {(effectiveMode === "register" || (effectiveMode === "login" && (!selectedRecentAccount && (showManualEmailEntry || recentAccounts.length === 0)))) ? (
            <label className="form-label">
              Email
              <input
                className="form-input"
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setSelectedRecentEmail("");
                  setShowManualEmailEntry(true);
                }}
                placeholder="you@example.com"
                autoFocus={effectiveMode === "login"}
              />
            </label>
          ) : null}

          {effectiveMode === "admin" && (
            <label className="form-label">
              PostgreSQL administrator username
              <input
                className="form-input"
                value={adminUsername}
                onChange={(event) => setAdminUsername(event.target.value)}
                autoFocus
                autoComplete="username"
              />
            </label>
          )}

          <label className="form-label">
            {effectiveMode === "admin" ? "PostgreSQL administrator password" : "Password"}
            <div className="password-input-wrap">
              <input
                className="form-input password-input-field"
                type={passwordVisible ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoFocus={effectiveMode !== "admin"}
              />
              <button
                type="button"
                className="password-visibility-btn"
                aria-label={passwordVisible ? "Hide password" : "Show password"}
                aria-pressed={passwordVisible}
                onClick={() => setPasswordVisible((current) => !current)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className="password-visibility-icon">
                  <path
                    d="M2 12s3.5-6 10-6s10 6 10 6s-3.5 6-10 6s-10-6-10-6Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
                </svg>
              </button>
            </div>
          </label>

          {authStatus ? (
            <p className="auth-hint">
              Registered PostgreSQL app users: {authStatus.registeredUserCount}
              <br />
              Session persistence: {rememberSession ? "enabled" : "disabled by default in Kanqual settings"}
            </p>
          ) : null}

          {error ? <p className="auth-error">{error}</p> : null}

          <div className="form-actions">
            <button type="button" className="btn" onClick={() => void onRefresh()} disabled={submitting}>
              Refresh
            </button>
            <button type="button" className="btn" onClick={onOpenCurrentApp} disabled={submitting}>
              Open current app
            </button>
            <button type="submit" className="btn btn--primary" disabled={submitting}>
              {submitting
                ? "Please wait..."
                : effectiveMode === "register"
                  ? "Create account"
                  : "Sign in"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PostgresProjectsExperimentView({
  authSession,
  onAuthSessionUpdated,
  onBack,
  onSignOut,
  onOpenCurrentApp,
}: {
  authSession: PostgresExperimentAuthSession;
  onAuthSessionUpdated: (session: PostgresExperimentAuthSession) => void;
  onBack: () => void;
  onSignOut: () => Promise<void>;
  onOpenCurrentApp: () => void;
}) {
  const [projects, setProjects] = useState<PostgresExperimentProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [openedProjectId, setOpenedProjectId] = useState<string | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState("");
  const [editingProjectDescription, setEditingProjectDescription] = useState("");
  const [removingProjectId, setRemovingProjectId] = useState<string | null>(null);
  const [deleteConfirmationName, setDeleteConfirmationName] = useState("");
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [menuProjectId, setMenuProjectId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const recordProjectOpened = useCallback(async (project: PostgresExperimentProject) => {
    const recentProject: PostgresExperimentRecentProject = {
      id: project.id,
      name: project.name,
      description: project.description,
      openedAt: new Date().toISOString(),
    };
    try {
      await rememberPostgresExperimentProjectOpened(recentProject);
    } catch (rememberError) {
      console.warn("Could not persist PostgreSQL recent project state:", describeUnknownError(rememberError));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadProjects() {
      setLoading(true);
      setError("");
      try {
        const [nextProjects, installationSettings, projectState] = await Promise.all([
          listPostgresExperimentProjects(),
          getPostgresExperimentInstallationSettings(),
          getPostgresExperimentUserProjectState(),
        ]);
        if (!cancelled) {
          setProjects(nextProjects);
          const reopenProjectId = installationSettings.startupReopenLastProject
            ? projectState.lastOpenedProjectId
            : null;
          const reopenProject = reopenProjectId
            ? nextProjects.find((project) => project.id === reopenProjectId) ?? null
            : null;
          setSelectedProjectId((current) => current ?? reopenProject?.id ?? nextProjects[0]?.id ?? null);
          setOpenedProjectId((current) => current ?? reopenProject?.id ?? null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setProjects([]);
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadProjects();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null;
  const openedProject = projects.find((project) => project.id === openedProjectId) ?? null;
  const projectPendingDelete = projects.find((project) => project.id === removingProjectId) ?? null;
  const canConfirmDelete = !!projectPendingDelete
    && deleteConfirmationName.trim() === projectPendingDelete.name.trim();

  const refreshProjects = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const nextProjects = await listPostgresExperimentProjects();
      setProjects(nextProjects);
      setSelectedProjectId((current) => {
        if (current && nextProjects.some((project) => project.id === current)) return current;
        return nextProjects[0]?.id ?? null;
      });
    } catch (refreshError) {
      setProjects([]);
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setLoading(false);
    }
  }, []);

  async function handleCreateProject(event: React.FormEvent<HTMLFormElement>): Promise<boolean> {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!name.trim()) {
      setError("Enter a project name for the PostgreSQL experiment.");
      return false;
    }

    setSubmitting(true);
    try {
      const created = await createPostgresExperimentProject({
        name: name.trim(),
        description: description.trim(),
      });
      await recordProjectOpened(created);
      setProjects((current) => [created, ...current.filter((project) => project.id !== created.id)]);
      setSelectedProjectId(created.id);
      setOpenedProjectId(created.id);
      setName("");
      setDescription("");
      setNotice(`Created PostgreSQL experiment project "${created.name}".`);
      return true;
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveProject() {
    if (!editingProjectId || !editingProjectName.trim()) {
      setError("Enter a project name for the PostgreSQL experiment.");
      return;
    }

    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const updated = await updatePostgresExperimentProject({
        projectId: editingProjectId,
        name: editingProjectName.trim(),
        description: editingProjectDescription.trim(),
      });
      setProjects((current) => current.map((project) => (project.id === updated.id ? updated : project)));
      setSelectedProjectId(updated.id);
      setEditingProjectId(null);
      setNotice(`Updated PostgreSQL experiment project "${updated.name}".`);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteProject(projectId: string) {
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      await deletePostgresExperimentProject(projectId);
      await removePostgresExperimentProjectFromState(projectId);
      setProjects((current) => current.filter((project) => project.id !== projectId));
      setSelectedProjectId((current) => (current === projectId ? null : current));
      setOpenedProjectId((current) => (current === projectId ? null : current));
      setRemovingProjectId(null);
      setDeleteConfirmationName("");
      setNotice("Deleted PostgreSQL experiment project.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    async function subscribeToProjectChanges() {
      unlisten = await listen<PostgresExperimentProjectChangeEvent>(POSTGRES_PROJECT_CHANGED_EVENT, (event) => {
        if (disposed) return;
        if (event.payload.entityType !== "project") return;
        void refreshProjects();
      });
    }

    void subscribeToProjectChanges();
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [refreshProjects]);

  useEffect(() => {
    if (!menuProjectId) return;

    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current) return;
      if (menuRef.current.contains(event.target as Node)) return;
      setMenuProjectId(null);
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [menuProjectId]);

  if (openedProject) {
    return (
      <PostgresProjectHomeExperimentView
        project={openedProject}
        authSession={authSession}
        onAuthSessionUpdated={onAuthSessionUpdated}
        onBack={() => setOpenedProjectId(null)}
        onProjectUpdated={(updatedProject) => {
          setProjects((current) => current.map((project) => (project.id === updatedProject.id ? updatedProject : project)));
          setSelectedProjectId(updatedProject.id);
        }}
        onProjectDeleted={(projectId) => {
          setProjects((current) => current.filter((project) => project.id !== projectId));
          setSelectedProjectId((current) => (current === projectId ? null : current));
          setOpenedProjectId((current) => (current === projectId ? null : current));
        }}
        onSignOut={onSignOut}
        onOpenCurrentApp={onOpenCurrentApp}
      />
    );
  }

  return (
    <div className="app-shell">
      <PostgresExperimentSidebar
        activeScreen="projects"
        activeProject={null}
        authSession={authSession}
        onShowProjects={() => undefined}
        onShowProjectHome={selectedProject ? () => setOpenedProjectId(selectedProject.id) : undefined}
        onShowProjectUsers={selectedProject ? () => setOpenedProjectId(selectedProject.id) : undefined}
        onBackToGate={onBack}
        onSignOut={onSignOut}
        onOpenCurrentApp={onOpenCurrentApp}
      />
      <main className="app-main">
        <div className="view projects-view">
          <header className="view-header">
            <div className="view-title-with-help">
              <h1>Projects</h1>
            </div>
            <div className="view-header-actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  setError("");
                  setNotice("");
                  setName("");
                  setDescription("");
                  setCreateProjectOpen(true);
                }}
              >
                New Project
              </button>
            </div>
          </header>

          {notice ? <p className="settings-success">{notice}</p> : null}
          {error ? <p className="auth-error">{error}</p> : null}

          {loading ? (
            <div className="empty-state">
              <p>Loading PostgreSQL experiment projects...</p>
            </div>
          ) : projects.length === 0 ? (
            <div className="empty-state">
              <p>No PostgreSQL experiment projects yet.</p>
              <div className="form-actions" style={{ justifyContent: "center", marginTop: 16 }}>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => {
                    setError("");
                    setNotice("");
                    setName("");
                    setDescription("");
                    setCreateProjectOpen(true);
                  }}
                >
                  Create your first project
                </button>
              </div>
            </div>
          ) : (
            <ul className="project-list">
              {projects.map((project) => (
                <li
                  key={project.id}
                  className="project-card"
                  onClick={() => {
                    setSelectedProjectId(project.id);
                    setOpenedProjectId(project.id);
                    void recordProjectOpened(project);
                  }}
                  style={{
                    cursor: "pointer",
                    outline: selectedProjectId === project.id ? "2px solid var(--color-primary)" : undefined,
                  }}
                >
                  <div
                    className="project-card-header"
                    ref={menuProjectId === project.id ? menuRef : null}
                  >
                    <div className="project-card-name">{project.name}</div>
                    <div className="project-card-topbar">
                      <button
                        type="button"
                        className="btn project-card-menu-button"
                        aria-label={`Actions for ${project.name}`}
                        aria-expanded={menuProjectId === project.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuProjectId((current) => (current === project.id ? null : project.id));
                        }}
                      >
                        Actions
                      </button>
                      {menuProjectId === project.id ? (
                        <div
                          className="project-card-menu"
                          role="menu"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="project-card-menu-item"
                            role="menuitem"
                            onClick={() => {
                              setMenuProjectId(null);
                              setSelectedProjectId(project.id);
                              setOpenedProjectId(project.id);
                              void recordProjectOpened(project);
                            }}
                          >
                            Open project
                          </button>
                          <button
                            type="button"
                            className="project-card-menu-item"
                            role="menuitem"
                            onClick={() => {
                              setMenuProjectId(null);
                              setEditingProjectId(project.id);
                              setEditingProjectName(project.name);
                              setEditingProjectDescription(project.description);
                            }}
                            disabled={submitting}
                          >
                            Edit project
                          </button>
                          <button
                            type="button"
                            className="project-card-menu-item project-card-menu-item--danger"
                            role="menuitem"
                            onClick={() => {
                              setMenuProjectId(null);
                              setDeleteConfirmationName("");
                              setRemovingProjectId(project.id);
                            }}
                            disabled={submitting}
                          >
                            Delete project
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="project-card-desc">{project.description || "No description yet."}</div>
                  <div className="project-card-meta">
                    <div className="project-card-meta-row">
                      <span className="project-card-meta-label">Created</span>
                      <span>{formatCurrentDateTime(project.createdAt)}</span>
                    </div>
                    <div className="project-card-meta-row">
                      <span className="project-card-meta-label">Updated</span>
                      <span>{formatCurrentDateTime(project.updatedAt)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {createProjectOpen ? (
            <div className="modal-overlay" onClick={() => !submitting && setCreateProjectOpen(false)}>
              <div className="modal" onClick={(event) => event.stopPropagation()}>
                <h2>New Project</h2>
                <form
                  onSubmit={async (event) => {
                    const created = await handleCreateProject(event);
                    if (created) {
                      setCreateProjectOpen(false);
                    }
                  }}
                  className="form"
                >
                  <label className="form-label">
                    Project name
                    <input
                      className="form-input"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="e.g. Dynamic Objects Pilot"
                      autoFocus
                    />
                  </label>
                  <label className="form-label">
                    Description
                    <textarea
                      className="form-input form-textarea"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="Short note about this project"
                      rows={3}
                    />
                  </label>
                  <div className="form-actions">
                    <button type="button" className="btn" onClick={() => setCreateProjectOpen(false)} disabled={submitting}>
                      Cancel
                    </button>
                    <button type="submit" className="btn btn--primary" disabled={submitting || !name.trim()}>
                      {submitting ? "Creating..." : "Create project"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}

          {editingProjectId ? (
            <div className="modal-overlay" onClick={() => !submitting && setEditingProjectId(null)}>
              <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
                <h2>Edit project</h2>
                <div className="form">
                  <label className="form-label">
                    Project name
                    <input
                      className="form-input"
                      value={editingProjectName}
                      onChange={(event) => setEditingProjectName(event.target.value)}
                      autoFocus
                    />
                  </label>
                  <label className="form-label">
                    Description
                    <textarea
                      className="form-input form-textarea"
                      rows={3}
                      value={editingProjectDescription}
                      onChange={(event) => setEditingProjectDescription(event.target.value)}
                    />
                  </label>
                  <div className="form-actions">
                    <button type="button" className="btn" onClick={() => setEditingProjectId(null)} disabled={submitting}>
                      Cancel
                    </button>
                    <button type="button" className="btn btn--primary" onClick={() => void handleSaveProject()} disabled={submitting || !editingProjectName.trim()}>
                      {submitting ? "Saving..." : "Save project"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {projectPendingDelete ? (
            <div className="modal-overlay" onClick={() => {
              if (submitting) return;
              setRemovingProjectId(null);
              setDeleteConfirmationName("");
            }}>
              <div className="modal" onClick={(event) => event.stopPropagation()}>
                <h2>Delete project</h2>
                <div className="form">
                <p className="import-project-copy">
                  This permanently deletes the PostgreSQL project and its local database, files, objects, relationships, and memberships.
                </p>
                <p className="import-project-copy">
                  Type <strong>{projectPendingDelete.name}</strong> to confirm.
                </p>
                <label className="form-label">
                  Project name
                  <input
                    className="form-input"
                    value={deleteConfirmationName}
                    onChange={(event) => {
                      setDeleteConfirmationName(event.target.value);
                      if (error) setError("");
                    }}
                    placeholder={projectPendingDelete.name}
                    autoFocus
                  />
                </label>
                <p className="modal-warning-text">
                  This removes the project record, drops the project database, and deletes the linked project storage directory.
                </p>
                <div className="form-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setRemovingProjectId(null);
                      setDeleteConfirmationName("");
                    }}
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn--danger"
                    onClick={() => void handleDeleteProject(projectPendingDelete.id)}
                    disabled={submitting || !canConfirmDelete}
                  >
                    {submitting ? "Deleting..." : "Delete project"}
                  </button>
                </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function PostgresProjectHomeExperimentView({
  project,
  authSession,
  onAuthSessionUpdated,
  onBack,
  onProjectUpdated,
  onProjectDeleted,
  onSignOut,
  onOpenCurrentApp,
}: {
  project: PostgresExperimentProject;
  authSession: PostgresExperimentAuthSession;
  onAuthSessionUpdated: (session: PostgresExperimentAuthSession) => void;
  onBack: () => void;
  onProjectUpdated: (project: PostgresExperimentProject) => void;
  onProjectDeleted: (projectId: string) => void;
  onSignOut: () => Promise<void>;
  onOpenCurrentApp: () => void;
}) {
  const PROJECT_ROLE_OPTIONS = ["owner", "editor", "coder", "viewer"] as const;
  const [activeScreen, setActiveScreen] = useState<
    "home" | "users" | "sources" | "annotations" | "codebook" | "code-text" | "memos" | "project-log" | "objects" | "relationships" | "free-draw" | "explore" | "construct" | "view" | "app-settings" | "project-settings" | "user-settings"
  >("home");
  const [postgresSourceNavigationTarget, setPostgresSourceNavigationTarget] = useState<{
    sourceId: string;
    annotationId: string | null;
  } | null>(null);
  const [postgresMemoDraftTarget, setPostgresMemoDraftTarget] = useState<{
    sourceIds?: string[];
    annotationIds?: string[];
    codeIds?: string[];
  } | null>(null);
  const [users, setUsers] = useState<PostgresExperimentProjectUser[]>([]);
  const [appUsers, setAppUsers] = useState<PostgresExperimentAppUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersSubmitting, setUsersSubmitting] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [userNotice, setUserNotice] = useState("");
  const [selectedAppUserId, setSelectedAppUserId] = useState("");
  const [userRole, setUserRole] = useState<(typeof PROJECT_ROLE_OPTIONS)[number]>("coder");
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<(typeof PROJECT_ROLE_OPTIONS)[number]>("coder");
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [objectTypes, setObjectTypes] = useState<PostgresExperimentObjectType[]>([]);
  const [objects, setObjects] = useState<PostgresExperimentObject[]>([]);
  const [objectAttributeDefinitions, setObjectAttributeDefinitions] = useState<PostgresExperimentObjectAttributeDefinition[]>([]);
  const [relationships, setRelationships] = useState<PostgresExperimentRelationship[]>([]);
  const [relationshipAttributeDefinitions, setRelationshipAttributeDefinitions] = useState<PostgresExperimentRelationshipAttributeDefinition[]>([]);
  const [savedDrawings, setSavedDrawings] = useState<PostgresExperimentSavedDrawingSummary[]>([]);
  const [savedCanvasSession, setSavedCanvasSession] = useState<PostgresExperimentSavedCanvasSession | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphSubmitting, setGraphSubmitting] = useState(false);
  const [graphError, setGraphError] = useState("");
  const [graphNotice, setGraphNotice] = useState("");
  const [relationshipAttributeEditorDraft, setRelationshipAttributeEditorDraft] = useState<PostgresExperimentRelationshipAttributeDraft | null>(null);
  const [relationshipAttributeEditorError, setRelationshipAttributeEditorError] = useState("");
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
  const [selectedObjectTypeFilter, setSelectedObjectTypeFilter] = useState<string>("all");
  const [showObjectAttributesTable, setShowObjectAttributesTable] = useState(false);
  const [objectTypeSortCol, setObjectTypeSortCol] = useState<PostgresExperimentObjectTypeSortCol>("objectType");
  const [objectTypeSortDir, setObjectTypeSortDir] = useState<"asc" | "desc">("asc");
  const [objectAttributeSortCol, setObjectAttributeSortCol] = useState<"name" | string>("name");
  const [objectAttributeSortDir, setObjectAttributeSortDir] = useState<"asc" | "desc">("asc");
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
  const [draftObjectTypeShape, setDraftObjectTypeShape] = useState<PostgresExperimentObjectTypeShape>("rounded");
  const [draftObjectTypeColor, setDraftObjectTypeColor] = useState(POSTGRES_OBJECT_TYPE_DEFAULT_COLOR);
  const [draftObjectTypeFill, setDraftObjectTypeFill] = useState<PostgresExperimentObjectFill>("filled");
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
  const [editingObjectAttributeValues, setEditingObjectAttributeValues] = useState<Record<string, string>>({});
  const [removingObjectId, setRemovingObjectId] = useState<string | null>(null);
  const [openObjectActionsMenu, setOpenObjectActionsMenu] = useState<{
    id: string;
    left: number;
    top: number;
  } | null>(null);
  const [fromObjectId, setFromObjectId] = useState("");
  const [toObjectId, setToObjectId] = useState("");
  const [relationshipTypes, setRelationshipTypes] = useState<PostgresExperimentRelationshipType[]>([]);
  const [createRelationshipTypeOpen, setCreateRelationshipTypeOpen] = useState(false);
  const [editingRelationshipTypeModalId, setEditingRelationshipTypeModalId] = useState<string | null>(null);
  const [removingRelationshipTypeId, setRemovingRelationshipTypeId] = useState<string | null>(null);
  const [draftRelationshipTypeName, setDraftRelationshipTypeName] = useState("");
  const [draftRelationshipLineShape, setDraftRelationshipLineShape] = useState<PostgresExperimentRelationshipLineShape>("solid");
  const [draftRelationshipLineWeight, setDraftRelationshipLineWeight] = useState(2);
  const [draftRelationshipArrowhead, setDraftRelationshipArrowhead] = useState<PostgresExperimentRelationshipArrowhead>("one_sided");
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
  const [relationshipTypeModalTab, setRelationshipTypeModalTab] = useState<"details" | "graphics" | "attributes">("details");
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
  const [canvasTool, setCanvasTool] = useState<PostgresExperimentCanvasTool>("select");
  const [canvasScale, setCanvasScale] = useState(1);
  const [canvasOffset, setCanvasOffset] = useState<PostgresExperimentCanvasPoint>({ x: 140, y: 120 });
  const [canvasNodes, setCanvasNodes] = useState<Record<string, PostgresExperimentCanvasNodeState>>({});
  const [canvasShapes, setCanvasShapes] = useState<PostgresExperimentCanvasShape[]>([]);
  const [hiddenCanvasRelationshipIds, setHiddenCanvasRelationshipIds] = useState<string[]>([]);
  const [canvasRelationshipTypeId, setCanvasRelationshipTypeId] = useState("");
  const [canvasStateLoaded, setCanvasStateLoaded] = useState(false);
  const [canvasSaveError, setCanvasSaveError] = useState("");
  const [freeDrawSaveNotice, setFreeDrawSaveNotice] = useState("");
  const [freeDrawSaving, setFreeDrawSaving] = useState(false);
  const [freeDrawSavedDrawingId, setFreeDrawSavedDrawingId] = useState<string | null>(null);
  const [saveFreeDrawModalOpen, setSaveFreeDrawModalOpen] = useState(false);
  const [saveFreeDrawName, setSaveFreeDrawName] = useState("");
  const [pendingCanvasNodePosition, setPendingCanvasNodePosition] = useState<PostgresExperimentCanvasPoint | null>(null);
  const pendingLocalGraphRefreshSkipsRef = useRef(0);
  const objectById = new Map(objects.map((object) => [object.id, object]));
  const objectTypeById = new Map(objectTypes.map((objectType) => [objectType.id, objectType]));
  const relationshipTypeById = new Map(relationshipTypes.map((relationshipType) => [relationshipType.id, relationshipType]));
  const selectedCreateObjectType = objectTypeById.get(objectTypeId) ?? null;
  const selectedEditObjectType = objectTypeById.get(editingObjectTypeId) ?? null;
  const relationshipAttributeRows = relationships
    .filter((relationship) => !editingRelationshipAttributeTypeId || relationship.relationshipTypeId === editingRelationshipAttributeTypeId)
    .map((relationship) => ({
    id: relationship.id,
    name: relationship.relationshipType,
  }));
  const objectTypeSummaries = useMemo(
    () => objectTypes
      .map((objectTypeRecord) => {
        const matchingObjects = objects.filter(
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
    [objectAttributeDefinitions, objectTypeSortCol, objectTypeSortDir, objectTypes, objects],
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
      const saved = await savePostgresExperimentSavedDrawing({
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
      ? objects
      : objects.filter((object) => object.objectTypeId === selectedObjectTypeFilter);
  const objectAttributeDefinitionsForWorkspace = useMemo(
    () => objectAttributeDefinitions
      .filter((definition) => selectedObjectTypeFilter === "all" || definition.objectTypeId === selectedObjectTypeFilter)
      .sort((left, right) => {
        if (selectedObjectTypeFilter === "all") {
          const objectTypeComparison = left.objectType.localeCompare(right.objectType);
          if (objectTypeComparison !== 0) return objectTypeComparison;
        }
        if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
        return left.name.localeCompare(right.name);
      }),
    [objectAttributeDefinitions, selectedObjectTypeFilter],
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
  const filteredSavedDrawings = savedDrawings.filter((drawing) => drawing.canvasKind === selectedCanvasViewKind);
  useEffect(() => {
    if (objectAttributeSortCol === "name") return;
    if (objectAttributeDefinitionsForWorkspace.some((definition) => definition.id === objectAttributeSortCol)) return;
    setObjectAttributeSortCol("name");
    setObjectAttributeSortDir("asc");
  }, [objectAttributeDefinitionsForWorkspace, objectAttributeSortCol]);

  function handleObjectAttributeSort(column: "name" | string) {
    if (objectAttributeSortCol === column) {
      setObjectAttributeSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setObjectAttributeSortCol(column);
    setObjectAttributeSortDir("asc");
  }

  function handleObjectTypeSort(column: PostgresExperimentObjectTypeSortCol) {
    if (objectTypeSortCol === column) {
      setObjectTypeSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setObjectTypeSortCol(column);
    setObjectTypeSortDir("asc");
  }
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
      };
    })
    .sort((left, right) => left.relationshipType.localeCompare(right.relationshipType));
  const filteredRelationships =
    selectedRelationshipTypeFilter === "all"
      ? relationships
      : relationships.filter((relationship) => relationship.relationshipTypeId === selectedRelationshipTypeFilter);
  const filteredRelationshipTypeSummaries = relationshipTypeSummaries.filter((summary) => {
    const query = relationshipTypeSearchTerm.trim().toLowerCase();
    if (!query) return true;
    return summary.relationshipType.toLowerCase().includes(query) || summary.constraint.toLowerCase().includes(query);
  });
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
  const availableFromObjects = selectedRelationshipType?.fromObjectTypeIds?.length
    ? objects.filter((object) => selectedRelationshipType.fromObjectTypeIds.includes(object.objectTypeId))
    : objects;
  const availableToObjects = selectedRelationshipType?.toObjectTypeIds?.length
    ? objects.filter((object) => selectedRelationshipType.toObjectTypeIds.includes(object.objectTypeId))
    : objects;
  const availableEditingFromObjects = editingRelationshipTypeRecord?.fromObjectTypeIds?.length
    ? objects.filter((object) => editingRelationshipTypeRecord.fromObjectTypeIds.includes(object.objectTypeId))
    : objects;
  const availableEditingToObjects = editingRelationshipTypeRecord?.toObjectTypeIds?.length
    ? objects.filter((object) => editingRelationshipTypeRecord.toObjectTypeIds.includes(object.objectTypeId))
    : objects;
  function openCreateObjectModal(prefilledTypeId?: string, preferredPosition?: PostgresExperimentCanvasPoint) {
    const nextTypeId = prefilledTypeId
      ?? (selectedObjectTypeFilter !== "all" ? selectedObjectTypeFilter : objectTypeId)
      ?? "";
    setObjectTypeId(nextTypeId || objectTypes[0]?.id || "");
    setObjectTitle("");
    setObjectDescription("");
    setObjectShapeOverride("");
    setObjectColorOverride("");
    setObjectFillOverride("");
    setObjectAttributeValues({});
    setCreateObjectModalTab("details");
    setGraphError("");
    setPendingCanvasNodePosition(preferredPosition ?? null);
    setCreateObjectOpen(true);
  }

  function openEditObjectModal(object: PostgresExperimentObject) {
    setEditingObjectId(object.id);
    setEditObjectModalTab("details");
    setEditingObjectTypeId(object.objectTypeId);
    setEditingObjectTitle(object.title);
    setEditingObjectDescription(object.description);
    setEditingObjectShapeOverride(object.shapeOverride ?? "");
    setEditingObjectColorOverride(object.colorOverride ?? "");
    setEditingObjectFillOverride(object.fillOverride ?? "");
    setEditingObjectAttributeValues(valuesForObject(object));
  }

  function openObjectTypeModalForEdit(objectTypeId: string, tab: "details" | "attributes") {
    const objectTypeRecord = objectTypeById.get(objectTypeId);
    if (!objectTypeRecord) return;
    setEditingObjectTypeModalId(objectTypeId);
    setDraftObjectTypeName(objectTypeRecord.name);
    setDraftObjectTypeDescription(objectTypeRecord.description);
    setDraftObjectTypeShape(
      normalizePostgresExperimentObjectTypeShape(objectTypeRecord.shape),
    );
    setDraftObjectTypeColor(
      normalizePostgresExperimentObjectTypeColor(objectTypeRecord.color),
    );
    setDraftObjectTypeFill(
      normalizePostgresExperimentObjectFill(objectTypeRecord.fill),
    );
    initializeObjectTypeAttributeEditor(objectTypeId);
    setObjectTypeModalTab(tab);
    setGraphError("");
    setGraphNotice("");
    setCreateObjectTypeOpen(false);
  }

  function openEditRelationshipModal(relationship: PostgresExperimentRelationship) {
    setEditRelationshipModalTab("details");
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

  function closeCreateRelationshipModal() {
    setCreateRelationshipOpen(false);
  }

  function closeCreateObjectModal() {
    setPendingCanvasNodePosition(null);
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
    hint: string;
    submitLabel: string;
    ariaLabel: string;
    onClose: () => void;
    onSubmit: (event: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
  }) {
    return (
      <div className="modal-overlay" onClick={() => !graphSubmitting && config.onClose()}>
        <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
          <h2>{config.title}</h2>
          <p className="auth-hint" style={{ marginTop: 0 }}>
            {config.hint}
          </p>
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
                className={`auth-tab ${relationshipTypeModalTab === "graphics" ? "auth-tab--active" : ""}`}
                onClick={() => setRelationshipTypeModalTab("graphics")}
              >
                Graphics
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
                  Allowed source object types
                  <PostgresExperimentObjectTypeRestrictionPicker
                    value={draftRelationshipFromObjectTypeIds}
                    onChange={setDraftRelationshipFromObjectTypeIds}
                    objectTypes={objectTypes}
                    emptyLabel="No restriction"
                  />
                </label>
                <label className="form-label">
                  Allowed target object types
                  <PostgresExperimentObjectTypeRestrictionPicker
                    value={draftRelationshipToObjectTypeIds}
                    onChange={setDraftRelationshipToObjectTypeIds}
                    objectTypes={objectTypes}
                    emptyLabel="No restriction"
                  />
                </label>
              </>
            ) : relationshipTypeModalTab === "graphics" ? (
              <>
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
                  <PostgresExperimentRelationshipLineShapePicker
                    value={draftRelationshipLineShape}
                    onChange={(value) => setDraftRelationshipLineShape((value || "solid") as PostgresExperimentRelationshipLineShape)}
                    previewColor={draftRelationshipColor}
                  />
                </label>
                <label className="form-label">
                  Line weight
                  <PostgresExperimentRelationshipLineWeightPicker
                    value={draftRelationshipLineWeight}
                    onChange={(value) => setDraftRelationshipLineWeight(value ?? 2)}
                    previewColor={draftRelationshipColor}
                  />
                </label>
                <label className="form-label">
                  Arrowheads
                  <PostgresExperimentRelationshipArrowheadPicker
                    value={draftRelationshipArrowhead}
                    onChange={(value) => setDraftRelationshipArrowhead((value || "one_sided") as PostgresExperimentRelationshipArrowhead)}
                    previewColor={draftRelationshipColor}
                  />
                </label>
              </>
            ) : (
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
    selectedType: PostgresExperimentObjectType | null;
    attributeDefinitions: PostgresExperimentObjectAttributeDefinition[];
    attributeValues: Record<string, string>;
    onClose: () => void;
    onSubmit: (event: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
    setObjectTypeId: Dispatch<SetStateAction<string>>;
    setTitleValue: Dispatch<SetStateAction<string>>;
    setDescriptionValue: Dispatch<SetStateAction<string>>;
    setColorOverride: Dispatch<SetStateAction<string>>;
    setShapeOverride: Dispatch<SetStateAction<string>>;
    setFillOverride: Dispatch<SetStateAction<string>>;
    setAttributeValues: Dispatch<SetStateAction<Record<string, string>>>;
  }) {
    const inheritedColor = normalizePostgresExperimentObjectTypeColor(config.selectedType?.color || "");
    const effectiveColor = resolvePostgresExperimentObjectColor({ colorOverride: config.colorOverride }, config.selectedType);
    const colorInherited = !config.colorOverride.trim();
    const inheritedShape = resolvePostgresExperimentObjectShape({ shapeOverride: "" }, config.selectedType);
    const effectiveShape = resolvePostgresExperimentObjectShape({ shapeOverride: config.shapeOverride }, config.selectedType);
    const shapeInherited = !config.shapeOverride.trim();
    const inheritedFill = resolvePostgresExperimentObjectFill({ fillOverride: "" }, config.selectedType);
    const effectiveFill = resolvePostgresExperimentObjectFill({ fillOverride: config.fillOverride }, config.selectedType);
    const fillInherited = !config.fillOverride.trim();

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
                <label className="form-label">
                  {renderOverrideFieldHeader("Color", {
                    inherited: colorInherited,
                    inheritedFrom: "object type",
                    onReset: () => config.setColorOverride(""),
                  })}
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
                  {renderOverrideFieldHeader("Shape", {
                    inherited: shapeInherited,
                    inheritedFrom: "object type",
                    onReset: () => config.setShapeOverride(""),
                  })}
                  <PostgresExperimentObjectShapePicker
                    value={effectiveShape}
                    onChange={(value) => config.setShapeOverride(value === inheritedShape ? "" : value)}
                    previewColor={effectiveColor}
                    previewFill={effectiveFill}
                  />
                </label>
                <label className="form-label">
                  {renderOverrideFieldHeader("Fill", {
                    inherited: fillInherited,
                    inheritedFrom: "object type",
                    onReset: () => config.setFillOverride(""),
                  })}
                  <PostgresExperimentObjectFillPicker
                    value={effectiveFill}
                    onChange={(value) => config.setFillOverride(value === inheritedFill ? "" : value)}
                    previewColor={effectiveColor}
                    previewShape={effectiveShape}
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
    availableFromObjects: PostgresExperimentObject[];
    availableToObjects: PostgresExperimentObject[];
    selectedType: PostgresExperimentRelationshipType | null;
    attributeDefinitions: PostgresExperimentRelationshipAttributeDefinition[];
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
  }) {
    const inheritedRelationshipColor = normalizePostgresExperimentRelationshipColor(config.selectedType?.color || "");
    const relationshipColorIsInherited = !config.colorOverride.trim();
    const effectiveRelationshipColor = resolvePostgresExperimentRelationshipColor({ colorOverride: config.colorOverride }, config.selectedType);
    const inheritedRelationshipLineShape = resolvePostgresExperimentRelationshipLineShape({ lineShapeOverride: "" }, config.selectedType);
    const relationshipLineShapeIsInherited = !config.lineShapeOverride.trim();
    const effectiveRelationshipLineShape = resolvePostgresExperimentRelationshipLineShape({ lineShapeOverride: config.lineShapeOverride }, config.selectedType);
    const inheritedRelationshipLineWeight = resolvePostgresExperimentRelationshipLineWeight({ lineWeightOverride: null }, config.selectedType);
    const relationshipLineWeightIsInherited = config.lineWeightOverride == null;
    const effectiveRelationshipLineWeight = resolvePostgresExperimentRelationshipLineWeight({ lineWeightOverride: config.lineWeightOverride }, config.selectedType);
    const inheritedRelationshipArrowhead = resolvePostgresExperimentRelationshipArrowhead({ arrowheadOverride: "" }, config.selectedType);
    const relationshipArrowheadIsInherited = !config.arrowheadOverride.trim();
    const effectiveRelationshipArrowhead = resolvePostgresExperimentRelationshipArrowhead({ arrowheadOverride: config.arrowheadOverride }, config.selectedType);

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
                  <select className="form-input" value={config.relationshipTypeId} onChange={(event) => config.setRelationshipTypeId(event.target.value)} autoFocus>
                    <option value="">Select relationship type</option>
                    {relationshipTypes.map((relationshipType) => (
                      <option key={relationshipType.id} value={relationshipType.id}>{relationshipType.name}</option>
                    ))}
                  </select>
                </label>
                {config.selectedType ? (
                  <p className="auth-hint" style={{ marginTop: 0 }}>
                    {`This relationship type rule is: ${formatRelationshipTypeConstraintSummary(config.selectedType)}.`}
                  </p>
                ) : null}
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
                  <PostgresExperimentRelationshipLineShapePicker
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
                  <PostgresExperimentRelationshipLineWeightPicker
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
                  <PostgresExperimentRelationshipArrowheadPicker
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
              <button type="submit" className="btn btn--primary" disabled={graphSubmitting || objects.length < 2}>
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

  function getEditableRolesForUser(user: PostgresExperimentProjectUser) {
    if (!canChangeRoles) return [user.role];
    if (user.role === "owner" && !isProjectAdmin && ownerCount <= 1) return ["owner"];
    if (isProjectAdmin || currentProjectUser?.role === "owner") return [...PROJECT_ROLE_OPTIONS];
    return [user.role];
  }

  function getInviteRoles() {
    if (isProjectAdmin || currentProjectUser?.role === "owner") return [...PROJECT_ROLE_OPTIONS];
    return PROJECT_ROLE_OPTIONS.filter((role) => role !== "owner");
  }

  function getRemoveBlockReason(user: PostgresExperimentProjectUser) {
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
          listPostgresExperimentProjectUsers(project.id),
          listPostgresExperimentAppUsers(),
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
          nextRelationships,
          nextObjectAttributeDefinitions,
          nextRelationshipAttributeDefinitions,
          nextSavedDrawings,
        ] = await Promise.all([
          listPostgresExperimentObjectTypes(project.id),
          listPostgresExperimentRelationshipTypes(project.id),
          listPostgresExperimentObjects(project.id),
          listPostgresExperimentRelationships(project.id),
          listPostgresExperimentObjectAttributeDefinitions(project.id),
          listPostgresExperimentRelationshipAttributeDefinitions(project.id),
          listPostgresExperimentSavedDrawingSummaries(project.id),
        ]);
        if (!cancelled) {
          setObjectTypes(nextObjectTypes);
          setRelationshipTypes(nextRelationshipTypes);
          setObjects(nextObjects);
          setRelationships(nextRelationships);
          setObjectAttributeDefinitions(nextObjectAttributeDefinitions);
          setRelationshipAttributeDefinitions(nextRelationshipAttributeDefinitions);
          setSavedDrawings(nextSavedDrawings);
          setFromObjectId((current) => current || nextObjects[0]?.id || "");
          setToObjectId((current) => current || nextObjects[1]?.id || nextObjects[0]?.id || "");
          setRelationshipTypeId((current) => current || nextRelationshipTypes[0]?.id || "");
          setCanvasRelationshipTypeId((current) => current || nextRelationshipTypes[0]?.id || "");
        }
      } catch (loadError) {
        if (!cancelled) {
          setObjectTypes([]);
          setRelationshipTypes([]);
          setObjects([]);
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
        const nextCanvasState = await getPostgresExperimentProjectCanvasState(project.id);
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
        listPostgresExperimentProjectUsers(project.id),
        listPostgresExperimentAppUsers(),
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
      const nextSavedDrawings = await listPostgresExperimentSavedDrawingSummaries(project.id);
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
        const drawing = await getPostgresExperimentSavedDrawing(project.id, drawingId);
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

  function buildSavedDrawingSvg(drawing: PostgresExperimentSavedDrawing, mode: "screen" | "pdf" = "screen") {
    const visibleNodeStates: PostgresExperimentCanvasNodeState[] = drawing.state.nodes;
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
        nodeState: PostgresExperimentCanvasNodeState;
        object: PostgresExperimentObject;
        objectTypeRecord: PostgresExperimentObjectType | null;
      } => !!entry);
    const visibleRelationships = relationships.filter(
      (relationship) =>
        !drawing.state.hiddenRelationshipIds.includes(relationship.id)
        && visibleNodeIds.has(relationship.fromObjectId)
        && visibleNodeIds.has(relationship.toObjectId),
    );

    const shapeBounds = drawing.state.shapes.map((shape: PostgresExperimentCanvasShape) => {
      if (shape.kind === "pen") {
        const xs = shape.points.map((point: PostgresExperimentCanvasPoint) => point.x);
        const ys = shape.points.map((point: PostgresExperimentCanvasPoint) => point.y);
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

    const nodeBounds = visibleObjects.map(({ nodeState }: { nodeState: PostgresExperimentCanvasNodeState }) => ({
      left: nodeState.x,
      top: nodeState.y,
      right: nodeState.x + (nodeState.width || 220),
      bottom: nodeState.y + (nodeState.height || 110),
    }));

    const relationshipBounds = visibleRelationships.map((relationship) => {
      const source = visibleNodeStates.find((node: PostgresExperimentCanvasNodeState) => node.id === relationship.fromObjectId);
      const target = visibleNodeStates.find((node: PostgresExperimentCanvasNodeState) => node.id === relationship.toObjectId);
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
      const source = visibleNodeStates.find((node: PostgresExperimentCanvasNodeState) => node.id === relationship.fromObjectId);
      const target = visibleNodeStates.find((node: PostgresExperimentCanvasNodeState) => node.id === relationship.toObjectId);
      if (!source || !target) return "";
      const sourceX = source.x + (source.width || 220) / 2 - minX;
      const sourceY = source.y + (source.height || 110) / 2 - minY;
      const targetX = target.x + (target.width || 220) / 2 - minX;
      const targetY = target.y + (target.height || 110) / 2 - minY;
      const relationshipTypeRecord = relationshipTypeById.get(relationship.relationshipTypeId) ?? null;
      const appearance = getPostgresExperimentRelationshipAppearance(relationship, relationshipTypeRecord);
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
          stroke-width="${getPostgresExperimentRelationshipStrokeWidth(appearance.lineWeight)}"
          ${getPostgresExperimentRelationshipStrokeDasharray(appearance.lineShape) ? `stroke-dasharray="${getPostgresExperimentRelationshipStrokeDasharray(appearance.lineShape)}"` : ""}
          ${appearance.arrowhead === "none" ? "" : `marker-end="url(#${markerEndId})"`}
          ${appearance.arrowhead === "double_sided" ? `marker-start="url(#${markerStartId})"` : ""}
        />
        <text x="${(sourceX + targetX) / 2}" y="${(sourceY + targetY) / 2 - 8}" text-anchor="middle" font-size="12" font-weight="700" fill="${appearance.color}">${escapeSvgText(relationship.relationshipType)}</text>
      `;
    }).join("");

    const shapeSvg = drawing.state.shapes.map((shape: PostgresExperimentCanvasShape) => {
      return renderCanvasSketchShapeSvg(shape, minX, minY, mode);
    }).join("");

    const objectSvg = visibleObjects.map(({ nodeState, object, objectTypeRecord }: {
      nodeState: PostgresExperimentCanvasNodeState;
      object: PostgresExperimentObject;
      objectTypeRecord: PostgresExperimentObjectType | null;
    }) => {
      const appearance = getPostgresExperimentObjectAppearance(object, objectTypeRecord);
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

  async function renderSavedDrawingCanvas(drawing: PostgresExperimentSavedDrawing): Promise<{
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

  async function renderSavedDrawingPngBytes(drawing: PostgresExperimentSavedDrawing): Promise<Uint8Array> {
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
      const drawing = await getPostgresExperimentSavedDrawing(project.id, drawingSummary.id);
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
      await deletePostgresExperimentSavedDrawing(project.id, drawingId);
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
      const created = await createPostgresExperimentProjectUser({
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

  async function handleSaveUserRole(user: PostgresExperimentProjectUser) {
    setUsersError("");
    setUserNotice("");
    setUsersSubmitting(true);
    try {
      const updated = await updatePostgresExperimentProjectUser({
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

  async function handleRemoveUser(user: PostgresExperimentProjectUser) {
    const blockReason = getRemoveBlockReason(user);
    if (blockReason) {
      setUsersError(blockReason);
      return;
    }

    setUsersError("");
    setUserNotice("");
    setUsersSubmitting(true);
    try {
      await deletePostgresExperimentProjectUser(project.id, user.id);
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
        nextRelationships,
        nextObjectAttributeDefinitions,
        nextRelationshipAttributeDefinitions,
        nextSavedDrawings,
        nextCanvasState,
      ] = await Promise.all([
        listPostgresExperimentObjectTypes(project.id),
        listPostgresExperimentRelationshipTypes(project.id),
        listPostgresExperimentObjects(project.id),
        listPostgresExperimentRelationships(project.id),
        listPostgresExperimentObjectAttributeDefinitions(project.id),
        listPostgresExperimentRelationshipAttributeDefinitions(project.id),
        listPostgresExperimentSavedDrawingSummaries(project.id),
        getPostgresExperimentProjectCanvasState(project.id),
      ]);
      setObjectTypes(nextObjectTypes);
      setRelationshipTypes(nextRelationshipTypes);
      setObjects(nextObjects);
      setRelationships(nextRelationships);
      setObjectAttributeDefinitions(nextObjectAttributeDefinitions);
      setRelationshipAttributeDefinitions(nextRelationshipAttributeDefinitions);
      setSavedDrawings(nextSavedDrawings);
      setFromObjectId((current) => current || nextObjects[0]?.id || "");
      setToObjectId((current) => current || nextObjects[1]?.id || nextObjects[0]?.id || "");
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
      unlisten = await listen<PostgresExperimentProjectChangeEvent>(POSTGRES_PROJECT_CHANGED_EVENT, (event) => {
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
    if (fromObjectId && availableFromObjects.some((object) => object.id === fromObjectId)) return;
    setFromObjectId(availableFromObjects[0]?.id ?? "");
  }, [availableFromObjects, fromObjectId]);

  useEffect(() => {
    if (toObjectId && availableToObjects.some((object) => object.id === toObjectId)) return;
    setToObjectId(availableToObjects[0]?.id ?? "");
  }, [availableToObjects, toObjectId]);

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
      const next: Record<string, PostgresExperimentCanvasNodeState> = {};
      objects.forEach((object, index) => {
        const existing = current[object.id];
        if (existing) {
          next[object.id] = existing;
          return;
        }
        const objectTypeRecord = objectTypeById.get(object.objectTypeId) ?? null;
        const shape = getPostgresExperimentObjectAppearance(object, objectTypeRecord).shape;
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
      void savePostgresExperimentProjectCanvasState({
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
    definitions: PostgresExperimentObjectAttributeDefinition[],
    valuesByDefinitionId: Record<string, string>,
  ) {
    return definitions.map((definition) => ({
      attributeDefinitionId: definition.id,
      value: valuesByDefinitionId[definition.id] ?? "",
    }));
  }

  function valuesForObject(object: PostgresExperimentObject): Record<string, string> {
    const valuesByDefinitionId: Record<string, string> = {};
    for (const value of object.attributeValues) {
      valuesByDefinitionId[value.attributeDefinitionId] = value.value;
    }
    return valuesByDefinitionId;
  }

  function toRelationshipAttributePayload(
    definitions: PostgresExperimentRelationshipAttributeDefinition[],
    valuesByDefinitionId: Record<string, string>,
  ) {
    return definitions.map((definition) => ({
      attributeDefinitionId: definition.id,
      value: valuesByDefinitionId[definition.id] ?? "",
    }));
  }

  function valuesForRelationship(relationship: PostgresExperimentRelationship): Record<string, string> {
    const valuesByDefinitionId: Record<string, string> = {};
    for (const value of relationship.attributeValues) {
      valuesByDefinitionId[value.attributeDefinitionId] = value.value;
    }
    return valuesByDefinitionId;
  }

  async function handleSaveRelationshipAttributeDefinition(
    draft: PostgresExperimentRelationshipAttributeDraft,
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
        ? await updatePostgresExperimentRelationshipAttributeDefinition({
            projectId: project.id,
            attributeDefinitionId: draft.id,
            relationshipTypeId: editingRelationshipAttributeTypeId,
            name: draft.name,
            dataType: draft.dataType,
            description: draft.description,
            options: draft.options,
          })
        : await createPostgresExperimentRelationshipAttributeDefinition({
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
          savePostgresExperimentRelationship({
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
      const created = await savePostgresExperimentObject({
        projectId: project.id,
        objectId: null,
        objectTypeId,
        title: objectTitle.trim(),
        description: objectDescription.trim(),
        shapeOverride: objectShapeOverride.trim() || null,
        colorOverride: normalizeOptionalPostgresExperimentObjectTypeColor(objectColorOverride) || null,
        fillOverride: objectFillOverride.trim() || null,
        attributeValues: toObjectAttributePayload(objectAttributeDefinitionsForCreateType, objectAttributeValues),
      });
      setObjects((current) => [...current, created]);
      setObjectTitle("");
      setObjectDescription("");
      setObjectShapeOverride("");
      setObjectColorOverride("");
      setObjectFillOverride("");
      setObjectAttributeValues({});
      setSelectedObjectTypeFilter(created.objectTypeId || "all");
      closeCreateObjectModal();
      if (pendingCanvasNodePosition) {
        const objectTypeRecord = objectTypeById.get(created.objectTypeId) ?? null;
        const shape = getPostgresExperimentObjectAppearance(created, objectTypeRecord).shape;
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
      const saved = await savePostgresExperimentObjectType({
        projectId: project.id,
        objectTypeId: null,
        name: resolvedType,
        description: draftObjectTypeDescription.trim(),
        shape: draftObjectTypeShape,
        color: normalizePostgresExperimentObjectTypeColor(draftObjectTypeColor),
        fill: draftObjectTypeFill,
        attributes: objectTypeAttributeDrafts.map((draft) => ({
          id: draft.id || null,
          name: draft.name,
          dataType: draft.dataType,
          description: draft.description,
          options: draft.options,
        })),
      });
      applySavedObjectTypeState(saved.objectType, saved.attributeDefinitions);
      setDraftObjectTypeName("");
      setDraftObjectTypeDescription("");
      setDraftObjectTypeShape("rounded");
      setDraftObjectTypeColor(POSTGRES_OBJECT_TYPE_DEFAULT_COLOR);
      setDraftObjectTypeFill("filled");
      initializeObjectTypeAttributeEditor(null);
      setObjectTypeModalTab("details");
      setCreateObjectTypeOpen(false);
      setSelectedObjectTypeFilter(saved.objectType.id);
      setObjectTypeId(saved.objectType.id);
      setObjectTitle("");
      setObjectDescription("");
      setObjectAttributeValues({});
      setGraphNotice(`Created object type "${saved.objectType.name}".`);
    } catch (error) {
      pendingLocalGraphRefreshSkipsRef.current = 0;
      setGraphError(error instanceof Error ? error.message : String(error));
    } finally {
      setGraphSubmitting(false);
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
      const saved = await savePostgresExperimentObjectType({
        projectId: project.id,
        objectTypeId: editingObjectTypeModalId,
        name: nextType,
        description: draftObjectTypeDescription.trim(),
        shape: draftObjectTypeShape,
        color: normalizePostgresExperimentObjectTypeColor(draftObjectTypeColor),
        fill: draftObjectTypeFill,
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
      await deletePostgresExperimentObjectType(project.id, objectTypeId);
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
      const updated = await savePostgresExperimentObject({
        projectId: project.id,
        objectId: editingObjectId,
        objectTypeId: editingObjectTypeId,
        title: editingObjectTitle.trim(),
        description: editingObjectDescription.trim(),
        shapeOverride: editingObjectShapeOverride.trim() || null,
        colorOverride: normalizeOptionalPostgresExperimentObjectTypeColor(editingObjectColorOverride) || null,
        fillOverride: editingObjectFillOverride.trim() || null,
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
      await deletePostgresExperimentObject(project.id, objectId);
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
    savedObjectType: PostgresExperimentObjectType,
    savedAttributeDefinitions: PostgresExperimentObjectAttributeDefinition[],
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
    savedRelationshipType: PostgresExperimentRelationshipType,
    savedAttributeDefinitions: PostgresExperimentRelationshipAttributeDefinition[],
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
      setDraftRelationshipFromObjectTypeIds([]);
      setDraftRelationshipToObjectTypeIds([]);
      initializeRelationshipTypeAttributeEditor(null);
      setCreateRelationshipTypeOpen(false);
      setRelationshipTypeId(existingType.id);
      setGraphNotice(`Switched to existing relationship type "${existingType.name}".`);
      return;
    }

    setGraphSubmitting(true);
    try {
      pendingLocalGraphRefreshSkipsRef.current = 1;
      const saved = await savePostgresExperimentRelationshipType({
        projectId: project.id,
        relationshipTypeId: null,
        name: nextType,
        description: "",
        lineShape: draftRelationshipLineShape,
        lineWeight: draftRelationshipLineWeight,
        arrowhead: draftRelationshipArrowhead,
        color: normalizePostgresExperimentRelationshipColor(draftRelationshipColor),
        fromObjectTypeIds: draftRelationshipFromObjectTypeIds,
        toObjectTypeIds: draftRelationshipToObjectTypeIds,
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
      setDraftRelationshipFromObjectTypeIds([]);
      setDraftRelationshipToObjectTypeIds([]);
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
      const saved = await savePostgresExperimentRelationshipType({
        projectId: project.id,
        relationshipTypeId: editingRelationshipTypeModalId,
        name: nextType,
        description: "",
        lineShape: draftRelationshipLineShape,
        lineWeight: draftRelationshipLineWeight,
        arrowhead: draftRelationshipArrowhead,
        color: normalizePostgresExperimentRelationshipColor(draftRelationshipColor),
        fromObjectTypeIds: draftRelationshipFromObjectTypeIds,
        toObjectTypeIds: draftRelationshipToObjectTypeIds,
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
      setDraftRelationshipFromObjectTypeIds([]);
      setDraftRelationshipToObjectTypeIds([]);
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
      await deletePostgresExperimentRelationshipType(project.id, relationshipTypeId);
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
    if (!fromObjectId || !toObjectId || !relationshipTypeId) {
      setGraphError("Choose two objects and a relationship type.");
      return;
    }

    setGraphSubmitting(true);
    try {
      pendingLocalGraphRefreshSkipsRef.current = 1;
      const created = await savePostgresExperimentRelationship({
        projectId: project.id,
        relationshipId: null,
        fromObjectId,
        toObjectId,
        relationshipTypeId,
        description: relationshipDescription.trim(),
        lineShapeOverride: relationshipLineShapeOverride.trim() || null,
        lineWeightOverride: relationshipLineWeightOverride,
        arrowheadOverride: relationshipArrowheadOverride.trim() || null,
        colorOverride: normalizeOptionalPostgresExperimentRelationshipColor(relationshipColorOverride) || null,
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
      const updated = await savePostgresExperimentRelationship({
        projectId: project.id,
        relationshipId: editingRelationshipId,
        fromObjectId: editingRelationshipFromObjectId,
        toObjectId: editingRelationshipToObjectId,
        relationshipTypeId: editingRelationshipTypeId,
        description: editingRelationshipDescription.trim(),
        lineShapeOverride: editingRelationshipLineShapeOverride.trim() || null,
        lineWeightOverride: editingRelationshipLineWeightOverride,
        arrowheadOverride: editingRelationshipArrowheadOverride.trim() || null,
        colorOverride: normalizeOptionalPostgresExperimentRelationshipColor(editingRelationshipColorOverride) || null,
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
      await deletePostgresExperimentRelationship(project.id, relationshipId);
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
      <PostgresExperimentSidebar
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
        onShowProjectLog={() => setActiveScreen("project-log")}
        onShowProjectObjects={() => setActiveScreen("objects")}
        onShowProjectRelationships={() => setActiveScreen("relationships")}
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
        onOpenCurrentApp={onOpenCurrentApp}
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
                      <span className="home-restricted-value">{formatPostgresExperimentDateTime(project.createdAt)}</span>
                    </div>
                    <div className="home-restricted-item">
                      <span className="home-restricted-label">Last updated</span>
                      <span className="home-restricted-value">{formatPostgresExperimentDateTime(lastProjectActivityAt)}</span>
                    </div>
                  </div>
                </section>
              </div>

              <div className="home-stats-grid postgres-experiment-home-stats-grid">
                <PostgresExperimentStatCard
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

                <PostgresExperimentStatCard
                  title="Objects"
                  count={objects.length}
                  stats={[
                    { label: "Types", value: objectTypeSummaries.length },
                    { label: "Attributes", value: objectAttributeDefinitions.length },
                    { label: "Described", value: objects.filter((object) => object.description.trim()).length },
                  ]}
                  onClick={() => setActiveScreen("objects")}
                />

                <PostgresExperimentStatCard
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

                <div className="users-content postgres-users-content">
                  {userNotice ? <p className="settings-success">{userNotice}</p> : null}
                  {usersError ? <p className="users-error">{usersError}</p> : null}

                  {usersLoading ? (
                    <div className="empty-state postgres-users-empty-state">
                      <p>Loading PostgreSQL project users...</p>
                    </div>
                  ) : users.length === 0 ? (
                    <div className="empty-state postgres-users-empty-state">
                      <p>No users have been added to this PostgreSQL project yet.</p>
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
                          {users.map((user) => (
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
            <PostgresProjectSourcesViewLazy
              projectId={project.id}
              currentUserId={authSession.user.id}
              canManageSources={canManageSources}
              canKickSourceLocks={canManageSources}
              canManageAnnotations={canManageAnnotations}
              canManageMemos={canManageMemos}
              initialSourceId={postgresSourceNavigationTarget?.sourceId ?? null}
              initialAnnotationId={postgresSourceNavigationTarget?.annotationId ?? null}
              onInitialNavigationHandled={() => setPostgresSourceNavigationTarget(null)}
              onOpenPostgresMemoDraft={(payload) => {
                setPostgresMemoDraftTarget(payload);
                setActiveScreen("memos");
              }}
            />
          ) : activeScreen === "code-text" ? (
            <PostgresAnalysisCodeSourcesViewLazy
              projectId={project.id}
              currentUserId={authSession.user.id}
              canManageSources={canManageSources}
              canKickSourceLocks={canManageSources}
              canManageAnnotations={canManageAnnotations}
              canManageMemos={canManageMemos}
              initialSourceId={postgresSourceNavigationTarget?.sourceId ?? null}
              initialAnnotationId={postgresSourceNavigationTarget?.annotationId ?? null}
              onInitialNavigationHandled={() => setPostgresSourceNavigationTarget(null)}
              onOpenPostgresMemoDraft={(payload) => {
                setPostgresMemoDraftTarget(payload);
                setActiveScreen("memos");
              }}
            />
          ) : activeScreen === "annotations" ? (
            <AnnotationsViewLazy
              postgresProjectId={project.id}
              postgresCurrentUserId={authSession.user.id}
              onOpenPostgresSourceAnnotation={({ sourceId, annotationId }) => {
                setPostgresSourceNavigationTarget({
                  sourceId,
                  annotationId,
                });
                setActiveScreen("sources");
              }}
            />
          ) : activeScreen === "codebook" ? (
            <CodebookViewLazy
              postgresProjectId={project.id}
              postgresCanCreateCodes={canManageAnnotations}
              postgresCanEditCodes={canManageAnnotations}
              postgresCanDeleteCodes={canManageAnnotations}
              postgresCanMemoAboutCodes={canManageMemos}
              onOpenPostgresSourceAnnotation={({ sourceId, annotationId }: { sourceId: string; annotationId: string }) => {
                setPostgresSourceNavigationTarget({
                  sourceId,
                  annotationId,
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
          ) : activeScreen === "memos" ? (
            <PostgresMemosViewLazy
              projectId={project.id}
              canManageMemos={canManageMemos}
              initialSourceIds={postgresMemoDraftTarget?.sourceIds ?? null}
              initialAnnotationIds={postgresMemoDraftTarget?.annotationIds ?? null}
              initialCodeIds={postgresMemoDraftTarget?.codeIds ?? null}
              onInitialDraftHandled={() => setPostgresMemoDraftTarget(null)}
            />
          ) : activeScreen === "project-log" ? (
            <PostgresProjectLogViewLazy
              projectId={project.id}
            />
          ) : activeScreen === "objects" ? (
            <>
              <div className="view users-view">
                <header className="view-header">
                  <div className="users-title-wrap">
                    <h1>
                      {selectedObjectTypeFilter === "all"
                        ? "Research Objects"
                        : `${objectTypeById.get(selectedObjectTypeFilter)?.name ?? "Selected"} Objects`}
                    </h1>
                  </div>
                  <div className="view-header-actions">
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
                  </div>
                </header>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(280px, 340px) minmax(0, 1fr)",
                    gap: 20,
                    alignItems: "start",
                    flex: 1,
                    minHeight: 0,
                  }}
                >
                  <div
                    className="home-primary-column"
                    style={{
                      alignSelf: "start",
                      justifyContent: "flex-start",
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
                                style={{ width: "50%" }}
                                onClick={() => handleObjectTypeSort("objectType")}
                              >
                                Type
                                <span className="users-sort-icon">
                                  {objectTypeSortCol === "objectType" ? (objectTypeSortDir === "asc" ? " ↑" : " ↓") : " ↕"}
                                </span>
                              </th>
                              <th
                                className={`users-th${objectTypeSortCol === "count" ? " users-th--sorted" : ""}`}
                                style={{ width: "18%" }}
                                onClick={() => handleObjectTypeSort("count")}
                              >
                                Count
                                <span className="users-sort-icon">
                                  {objectTypeSortCol === "count" ? (objectTypeSortDir === "asc" ? " ↑" : " ↓") : " ↕"}
                                </span>
                              </th>
                              <th className="users-th" style={{ width: "32%" }}>Actions</th>
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
                              <td className="users-td users-td--muted">{objects.length}</td>
                              <td className="users-td users-td--muted">-</td>
                            </tr>
                            {objectTypeSummaries.map((summary) => (
                              <tr
                                key={summary.objectTypeId}
                                className="users-row"
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
                                      shape={normalizePostgresExperimentObjectTypeShape(summary.shape)}
                                      fill={normalizePostgresExperimentObjectFill(summary.fill)}
                                      color={normalizePostgresExperimentObjectTypeColor(summary.color)}
                                      sourceVisualKey={getPostgresExperimentSourceObjectVisualKey(summary.systemKey)}
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
                                <td className="users-td">
                                  <button
                                    type="button"
                                    className="btn btn--ghost"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      const rect = event.currentTarget.getBoundingClientRect();
                                      setOpenObjectActionsMenu(null);
                                      setOpenObjectTypeActionsMenu((current) =>
                                        current?.id === summary.objectTypeId
                                          ? null
                                          : {
                                              id: summary.objectTypeId,
                                              left: Math.min(rect.left, window.innerWidth - 168),
                                              top: Math.min(rect.bottom + 4, window.innerHeight - 96),
                                            },
                                      );
                                    }}
                                  >
                                    Actions
                                  </button>
                                  {openObjectTypeActionsMenu?.id === summary.objectTypeId ? (
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
                                          openObjectTypeModalForEdit(summary.objectTypeId, "details");
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
                                          setRemovingObjectTypeId(summary.objectTypeId);
                                          setOpenObjectTypeActionsMenu(null);
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
                        {objectTypeSummaries.length === 0 ? (
                          <div className="empty-state" style={{ minHeight: 140 }}>
                            <p>No object types yet.</p>
                          </div>
                        ) : null}
                      </div>
                    </section>
                  </div>

                  <section
                    className="users-content"
                    style={{
                      alignItems: "stretch",
                      justifyContent: "flex-start",
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
                                    <tr key={row.id} className="users-row">
                                      <td className="users-td users-td--name case-attributes-case-cell">{row.name}</td>
                                      {objectAttributeDefinitionsForWorkspace.map((definition) => {
                                        const rawValue = row.valuesByDefinitionId[definition.id] ?? "";
                                        return (
                                          <td key={definition.id} className="users-td case-attributes-value-cell">
                                            {rawValue
                                              ? formatPostgresExperimentAttributeDisplay(rawValue, definition.dataType)
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
                              <th className="users-th" style={{ width: "34%" }}>Title</th>
                              <th className="users-th" style={{ width: "28%" }}>Type</th>
                              <th className="users-th" style={{ width: "20%" }}>Updated</th>
                              <th className="users-th" style={{ width: "18%" }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredObjects.map((object) => {
                              return (
                                <tr key={object.id} className="users-row">
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
                                  <td className="users-td">
                                    <button
                                      type="button"
                                      className="btn btn--ghost"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        const rect = event.currentTarget.getBoundingClientRect();
                                        setOpenObjectTypeActionsMenu(null);
                                        setOpenObjectActionsMenu((current) =>
                                          current?.id === object.id
                                            ? null
                                            : {
                                                id: object.id,
                                                left: Math.min(rect.right - 140, window.innerWidth - 156),
                                                top: Math.min(rect.bottom + 4, window.innerHeight - 96),
                                              },
                                        );
                                      }}
                                    >
                                      Actions
                                    </button>
                                    {openObjectActionsMenu?.id === object.id ? (
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
                                            openEditObjectModal(object);
                                            setOpenObjectActionsMenu(null);
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
                                            setRemovingObjectId(object.id);
                                            setOpenObjectActionsMenu(null);
                                          }}
                                        >
                                          Delete
                                      </button>
                                      </div>
                                    ) : null}
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
                    return (
                      <div className="modal-overlay" onClick={() => !graphSubmitting && setRemovingObjectTypeId(null)}>
                        <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
                          <h2>Delete object type</h2>
                          <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                            Delete <strong>{objectTypeRecord.name}</strong>?
                          </p>
                          <p className="modal-warning-text">
                            This deletes the object type and its shared attribute definitions. It will be blocked if any objects or relationship type restrictions still use this type.
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
                              <PostgresExperimentObjectShapePicker
                                value={draftObjectTypeShape}
                                onChange={(value) => setDraftObjectTypeShape((value || "rounded") as PostgresExperimentObjectTypeShape)}
                                previewColor={draftObjectTypeColor}
                                previewFill={draftObjectTypeFill}
                              />
                            </label>
                            <label className="form-label">
                              Fill
                              <PostgresExperimentObjectFillPicker
                                value={draftObjectTypeFill}
                                onChange={(value) => setDraftObjectTypeFill((value || "filled") as PostgresExperimentObjectFill)}
                                previewColor={draftObjectTypeColor}
                                previewShape={draftObjectTypeShape}
                              />
                            </label>
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
                              <PostgresExperimentObjectShapePicker
                                value={draftObjectTypeShape}
                                onChange={(value) => setDraftObjectTypeShape((value || "rounded") as PostgresExperimentObjectTypeShape)}
                                previewColor={draftObjectTypeColor}
                                previewFill={draftObjectTypeFill}
                              />
                            </label>
                            <label className="form-label">
                              Fill
                              <PostgresExperimentObjectFillPicker
                                value={draftObjectTypeFill}
                                onChange={(value) => setDraftObjectTypeFill((value || "filled") as PostgresExperimentObjectFill)}
                                previewColor={draftObjectTypeColor}
                                previewShape={draftObjectTypeShape}
                              />
                            </label>
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
              </div>
            </>
          ) : activeScreen === "relationships" ? (
            <>
              <div className="view users-view">
                <header className="view-header">
                  <div className="users-title-wrap">
                    <h1>
                      {selectedRelationshipTypeFilter === "all"
                        ? "Relationships"
                        : `${relationshipTypeById.get(selectedRelationshipTypeFilter)?.name ?? "Selected"} Relationships`}
                    </h1>
                  </div>
                  <div className="view-header-actions">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setDraftRelationshipTypeName("");
                        setDraftRelationshipLineShape("solid");
                        setDraftRelationshipLineWeight(2);
                        setDraftRelationshipArrowhead("one_sided");
                        setDraftRelationshipColor(POSTGRES_RELATIONSHIP_DEFAULT_COLOR);
                        setDraftRelationshipFromObjectTypeIds([]);
                        setDraftRelationshipToObjectTypeIds([]);
                        setRelationshipTypeModalTab("details");
                        initializeRelationshipTypeAttributeEditor(null);
                        setEditingRelationshipTypeModalId(null);
                        setGraphError("");
                        setCreateRelationshipTypeOpen(true);
                      }}
                    >
                      Add relationship type
                    </button>
                    <button type="button" className="btn btn--primary" onClick={() => openCreateRelationshipModal()}>
                      New relationship
                    </button>
                  </div>
                </header>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(280px, 340px) minmax(0, 1fr)",
                    gap: 20,
                    alignItems: "start",
                    flex: 1,
                    minHeight: 0,
                  }}
                >
                  <div className="home-primary-column" style={{ alignSelf: "start", justifyContent: "flex-start" }}>
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
                              <th className="users-th" style={{ width: "54%" }}>Type</th>
                              <th className="users-th" style={{ width: "14%" }}>Count</th>
                              <th className="users-th" style={{ width: "32%" }}>Actions</th>
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
                              <td className="users-td users-td--muted">-</td>
                            </tr>
                            {filteredRelationshipTypeSummaries.map((summary) => (
                              <tr
                                key={summary.relationshipTypeId}
                                className="users-row"
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
                                  <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                      {summary.relationshipType}
                                    </span>
                                    <span className="postgres-users-meta" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                      {summary.attributeDefinitionCount} attributes
                                    </span>
                                  </div>
                                </td>
                                <td className="users-td users-td--muted">{summary.count}</td>
                                <td className="users-td">
                                  <button
                                    type="button"
                                    className="btn btn--ghost"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      const rect = event.currentTarget.getBoundingClientRect();
                                      setOpenRelationshipActionsMenu(null);
                                      setOpenRelationshipTypeActionsMenu((current) =>
                                        current?.id === summary.relationshipTypeId
                                          ? null
                                          : {
                                              id: summary.relationshipTypeId,
                                              left: Math.min(rect.left, window.innerWidth - 168),
                                              top: Math.min(rect.bottom + 4, window.innerHeight - 96),
                                            },
                                      );
                                    }}
                                  >
                                    Actions
                                  </button>
                                  {openRelationshipTypeActionsMenu?.id === summary.relationshipTypeId ? (
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
                                          const relationshipType = relationshipTypeById.get(summary.relationshipTypeId);
                                          if (!relationshipType) return;
                                          setEditingRelationshipTypeModalId(relationshipType.id);
                                          setDraftRelationshipTypeName(relationshipType.name);
                                          setDraftRelationshipLineShape(normalizePostgresExperimentRelationshipLineShape(relationshipType.lineShape));
                                          setDraftRelationshipLineWeight(normalizePostgresExperimentRelationshipLineWeight(relationshipType.lineWeight));
                                          setDraftRelationshipArrowhead(normalizePostgresExperimentRelationshipArrowhead(relationshipType.arrowhead));
                                          setDraftRelationshipColor(normalizePostgresExperimentRelationshipColor(relationshipType.color));
                                          setDraftRelationshipFromObjectTypeIds(relationshipType.fromObjectTypeIds || []);
                                          setDraftRelationshipToObjectTypeIds(relationshipType.toObjectTypeIds || []);
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
                                          setRemovingRelationshipTypeId(summary.relationshipTypeId);
                                          setOpenRelationshipTypeActionsMenu(null);
                                          setGraphError("");
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
                        {filteredRelationshipTypeSummaries.length === 0 ? (
                          <div className="empty-state" style={{ minHeight: 140 }}>
                            <p>No relationship types match that search.</p>
                          </div>
                        ) : null}
                      </div>
                    </section>
                  </div>

                  <section className="users-content" style={{ alignItems: "stretch", justifyContent: "flex-start", gap: 16 }}>
                    {graphNotice ? <p className="settings-success">{graphNotice}</p> : null}
                    {graphError ? <p className="auth-error">{graphError}</p> : null}

                    {graphLoading ? (
                      <div className="empty-state postgres-users-empty-state">
                        <p>Loading relationships...</p>
                      </div>
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
                              <th className="users-th" style={{ width: "24%" }}>Type</th>
                              <th className="users-th" style={{ width: "24%" }}>From</th>
                              <th className="users-th" style={{ width: "24%" }}>To</th>
                              <th className="users-th" style={{ width: "14%" }}>Updated</th>
                              <th className="users-th" style={{ width: "14%" }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredRelationships.map((relationship) => {
                              const fromObject = objectById.get(relationship.fromObjectId);
                              const toObject = objectById.get(relationship.toObjectId);
                              return (
                                <tr key={relationship.id} className="users-row">
                                  <td className="users-td users-td--name">{relationship.relationshipType}</td>
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
                                  <td className="users-td">
                                    <button
                                      type="button"
                                      className="btn btn--ghost"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        const rect = event.currentTarget.getBoundingClientRect();
                                        setOpenRelationshipTypeActionsMenu(null);
                                        setOpenRelationshipActionsMenu((current) =>
                                          current?.id === relationship.id
                                            ? null
                                            : {
                                                id: relationship.id,
                                                left: Math.min(rect.right - 140, window.innerWidth - 156),
                                                top: Math.min(rect.bottom + 4, window.innerHeight - 96),
                                              },
                                        );
                                      }}
                                    >
                                      Actions
                                    </button>
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
                  return (
                    <div className="modal-overlay" onClick={() => !graphSubmitting && setRemovingRelationshipTypeId(null)}>
                      <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
                        <h2>Delete relationship type</h2>
                        <p style={{ marginBottom: 12, lineHeight: 1.5 }}>
                          Delete <strong>{relationshipTypeRecord.name}</strong>?
                        </p>
                        <p className="modal-warning-text">
                          This deletes the relationship type and its shared attribute definitions. It will be blocked if any relationships still use this type.
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
            </>
          ) : activeScreen === "free-draw" ? (
            <PostgresExperimentCanvasView
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
              onOpenCreateObjectType={() => setCreateObjectTypeOpen(true)}
              onOpenCreateRelationshipType={() => setCreateRelationshipTypeOpen(true)}
              onEditObject={openEditObjectModal}
              onDeleteObject={(objectId) => setRemovingObjectId(objectId)}
              onEditRelationship={openEditRelationshipModal}
              onDeleteRelationship={(relationshipId) => setRemovingRelationshipId(relationshipId)}
            />
          ) : activeScreen === "explore" ? (
            <PostgresExperimentExploreCanvasView
              objectTypes={objectTypes}
              objects={objects}
              relationships={relationships}
              relationshipTypes={relationshipTypes}
              canvasNodes={canvasNodes}
              setCanvasNodes={setCanvasNodes}
              hiddenCanvasRelationshipIds={hiddenCanvasRelationshipIds}
            />
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
            <PostgresAppSettingsExperimentView authSession={authSession} />
          ) : activeScreen === "project-settings" ? (
            <PostgresProjectSettingsExperimentView
              project={project}
              canManageProject={canManageProjectSettings}
              memberCount={users.length}
              ownerCount={ownerCount}
              objectCount={objects.length}
              relationshipCount={relationships.length}
              onProjectUpdated={onProjectUpdated}
              onProjectDeleted={onProjectDeleted}
            />
          ) : (
            <PostgresUserSettingsExperimentView
              authSession={authSession}
              onAuthSessionUpdated={onAuthSessionUpdated}
            />
          )}
          {createRelationshipTypeOpen ? (
            renderRelationshipTypeModal({
              title: "Add relationship type",
              hint: "Create a project-specific relationship type now, then use it to define shared relationship attributes.",
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
              setAttributeValues: setObjectAttributeValues,
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
              setAttributeValues: setEditingObjectAttributeValues,
            })
          ) : null}
          {createRelationshipOpen ? (
            renderRelationshipModal({
              title: "Create relationship",
              ariaLabel: "Create relationship tabs",
              tab: createRelationshipModalTab,
              setTab: setCreateRelationshipModalTab,
              submitLabel: "Add relationship",
              fromObjectId,
              toObjectId,
              relationshipTypeId,
              description: relationshipDescription,
              lineShapeOverride: relationshipLineShapeOverride,
              lineWeightOverride: relationshipLineWeightOverride,
              arrowheadOverride: relationshipArrowheadOverride,
              colorOverride: relationshipColorOverride,
              availableFromObjects,
              availableToObjects,
              selectedType: selectedRelationshipType,
              attributeDefinitions: relationshipAttributeDefinitionsForCreateType,
              attributeValues: relationshipAttributeValues,
              onClose: closeCreateRelationshipModal,
              onSubmit: handleCreateRelationship,
              setFromObjectId,
              setToObjectId,
              setRelationshipTypeId,
              setDescription: setRelationshipDescription,
              setLineShapeOverride: setRelationshipLineShapeOverride,
              setLineWeightOverride: setRelationshipLineWeightOverride,
              setArrowheadOverride: setRelationshipArrowheadOverride,
              setColorOverride: setRelationshipColorOverride,
              setAttributeValues: setRelationshipAttributeValues,
            })
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
          {activeScreen !== "relationships" && removingRelationshipId ? (
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

function PostgresExperimentCanvasView({
  projectId,
  objectTypes,
  objectAttributeDefinitions,
  objects,
  relationships,
  relationshipTypes,
  relationshipAttributeDefinitions,
  setRelationships,
  canvasNodes,
  setCanvasNodes,
  canvasShapes,
  setCanvasShapes,
  hiddenCanvasRelationshipIds,
  setHiddenCanvasRelationshipIds,
  canvasTool,
  setCanvasTool,
  canvasScale,
  setCanvasScale,
  canvasOffset,
  setCanvasOffset,
  canvasRelationshipTypeId,
  setCanvasRelationshipTypeId,
  freeDrawSaveNotice,
  freeDrawSaving,
  canvasSaveError,
  savedCanvasSession,
  onSaveDrawing,
  onCreateObjectAt,
  onOpenCreateObjectType,
  onOpenCreateRelationshipType,
  onEditObject,
  onDeleteObject,
  onEditRelationship,
  onDeleteRelationship,
}: {
  projectId: string;
  objectTypes: PostgresExperimentObjectType[];
  objectAttributeDefinitions: PostgresExperimentObjectAttributeDefinition[];
  objects: PostgresExperimentObject[];
  relationships: PostgresExperimentRelationship[];
  relationshipTypes: PostgresExperimentRelationshipType[];
  relationshipAttributeDefinitions: PostgresExperimentRelationshipAttributeDefinition[];
  setRelationships: Dispatch<SetStateAction<PostgresExperimentRelationship[]>>;
  canvasNodes: Record<string, PostgresExperimentCanvasNodeState>;
  setCanvasNodes: Dispatch<SetStateAction<Record<string, PostgresExperimentCanvasNodeState>>>;
  canvasShapes: PostgresExperimentCanvasShape[];
  setCanvasShapes: Dispatch<SetStateAction<PostgresExperimentCanvasShape[]>>;
  hiddenCanvasRelationshipIds: string[];
  setHiddenCanvasRelationshipIds: Dispatch<SetStateAction<string[]>>;
  canvasTool: PostgresExperimentCanvasTool;
  setCanvasTool: Dispatch<SetStateAction<PostgresExperimentCanvasTool>>;
  canvasScale: number;
  setCanvasScale: Dispatch<SetStateAction<number>>;
  canvasOffset: PostgresExperimentCanvasPoint;
  setCanvasOffset: Dispatch<SetStateAction<PostgresExperimentCanvasPoint>>;
  canvasRelationshipTypeId: string;
  setCanvasRelationshipTypeId: Dispatch<SetStateAction<string>>;
  freeDrawSaveNotice: string;
  freeDrawSaving: boolean;
  canvasSaveError: string;
  savedCanvasSession: PostgresExperimentSavedCanvasSession | null;
  onSaveDrawing: () => Promise<void>;
  onCreateObjectAt: (prefilledTypeId?: string, preferredPosition?: PostgresExperimentCanvasPoint) => void;
  onOpenCreateObjectType: () => void;
  onOpenCreateRelationshipType: () => void;
  onEditObject: (object: PostgresExperimentObject) => void;
  onDeleteObject: (objectId: string) => void;
  onEditRelationship: (relationship: PostgresExperimentRelationship) => void;
  onDeleteRelationship: (relationshipId: string) => void;
}) {
  const isReadOnly = savedCanvasSession?.mode === "view";
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const cyContainerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<CytoscapeCore | null>(null);
  const syncingViewportRef = useRef(false);
  const [canvasError, setCanvasError] = useState("");
  const [canvasNotice, setCanvasNotice] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [pendingConnectionSourceId, setPendingConnectionSourceId] = useState<string | null>(null);
  const [connectPreviewWorld, setConnectPreviewWorld] = useState<PostgresExperimentCanvasPoint | null>(null);
  const [hoveredConnectTargetId, setHoveredConnectTargetId] = useState<string | null>(null);
  const [canvasSketchShape, setCanvasSketchShape] = useState<PostgresExperimentCanvasDisplayShape>("rectangle");
  const [canvasSketchColor, setCanvasSketchColor] = useState("#355070");
  const [canvasSketchLineStyle, setCanvasSketchLineStyle] = useState<PostgresExperimentRelationshipLineShape>("solid");
  const [canvasSketchLineWeight, setCanvasSketchLineWeight] = useState<number>(2);
  const [canvasSketchColorMenuOpen, setCanvasSketchColorMenuOpen] = useState(false);
  const [canvasSketchLineStyleMenuOpen, setCanvasSketchLineStyleMenuOpen] = useState(false);
  const [canvasSketchLineWeightMenuOpen, setCanvasSketchLineWeightMenuOpen] = useState(false);
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const [objectMenuOpen, setObjectMenuOpen] = useState(false);
  const [existingObjectsModalOpen, setExistingObjectsModalOpen] = useState(false);
  const [connectMenuOpen, setConnectMenuOpen] = useState(false);
  const [existingRelationshipsModalOpen, setExistingRelationshipsModalOpen] = useState(false);
  const [newRelationshipModalOpen, setNewRelationshipModalOpen] = useState(false);
  const [draftCanvasRelationshipTypeId, setDraftCanvasRelationshipTypeId] = useState("");
  const [inspectorCollapsed, setInspectorCollapsed] = useState(true);
  const [canvasToolsCollapsed, setCanvasToolsCollapsed] = useState(false);
  const [editingTextShapeId, setEditingTextShapeId] = useState<string | null>(null);
  const objectTypeById = useMemo(
    () => new Map(objectTypes.map((objectType) => [objectType.id, objectType])),
    [objectTypes],
  );
  const interactionRef = useRef<{
    mode: "idle" | "draw-pen" | "draw-shape" | "move-shape" | "resize-shape";
    pointerId: number | null;
    startClientX: number;
    startClientY: number;
    startWorldX: number;
    startWorldY: number;
    shapeId: string | null;
    initialShape: PostgresExperimentCanvasShape | null;
    resizeHandle: "nw" | "ne" | "sw" | "se" | null;
  }>({
    mode: "idle",
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    startWorldX: 0,
    startWorldY: 0,
    shapeId: null,
    initialShape: null,
    resizeHandle: null,
  });
  const eraserInteractionRef = useRef<{
    pointerId: number | null;
    erasedShapeIds: Set<string>;
    erasedNodeIds: Set<string>;
    erasedEdgeIds: Set<string>;
  }>({
    pointerId: null,
    erasedShapeIds: new Set<string>(),
    erasedNodeIds: new Set<string>(),
    erasedEdgeIds: new Set<string>(),
  });
  const objectById = useMemo(() => new Map(objects.map((object) => [object.id, object])), [objects]);
  const relationshipById = useMemo(
    () => new Map(relationships.map((relationship) => [relationship.id, relationship])),
    [relationships],
  );
  const selectedRelationshipType = useMemo(
    () => relationshipTypes.find((relationshipType) => relationshipType.id === canvasRelationshipTypeId) ?? null,
    [canvasRelationshipTypeId, relationshipTypes],
  );
  const graphElements = useMemo(
    () => buildPostgresExperimentCanvasCytoscapeElements(
      objects,
      canvasNodes,
      objectTypeById,
      relationships,
      relationshipTypes,
      hiddenCanvasRelationshipIds,
    ),
    [canvasNodes, hiddenCanvasRelationshipIds, objectTypeById, objects, relationshipTypes, relationships],
  );
  const selectedObject = selectedNodeId ? objectById.get(selectedNodeId) ?? null : null;
  const selectedRelationship = selectedEdgeId ? relationshipById.get(selectedEdgeId) ?? null : null;
  const selectedShape = selectedShapeId ? canvasShapes.find((shape) => shape.id === selectedShapeId) ?? null : null;
  const showCanvasSketchStyleControls = !isReadOnly && (canvasTool === "pen" || canvasTool === "shape");
  const selectedObjectAttributeDefinitions = useMemo(
    () => objectAttributeDefinitions.filter((definition) => definition.objectTypeId === selectedObject?.objectTypeId),
    [objectAttributeDefinitions, selectedObject?.objectTypeId],
  );
  const selectedRelationshipAttributeDefinitions = useMemo(
    () => relationshipAttributeDefinitions.filter((definition) => definition.relationshipTypeId === selectedRelationship?.relationshipTypeId),
    [relationshipAttributeDefinitions, selectedRelationship?.relationshipTypeId],
  );
  const latestCanvasInteractionRef = useRef({
    isReadOnly,
    canvasTool,
    canvasRelationshipTypeId,
    canvasNodes,
  });
  const commitCanvasNodePositionRef = useRef<(node: { id: string; position: { x: number; y: number } }) => void>(() => {});
  const handleConnectRef = useRef<(connection: { source?: string | null; target?: string | null }) => Promise<void>>(async () => {});

  useEffect(() => {
    latestCanvasInteractionRef.current = {
      isReadOnly,
      canvasTool,
      canvasRelationshipTypeId,
      canvasNodes,
    };
  }, [canvasNodes, canvasRelationshipTypeId, canvasTool, isReadOnly]);

  useEffect(() => {
    if (canvasTool !== "connect") {
      setPendingConnectionSourceId(null);
      setConnectPreviewWorld(null);
      setHoveredConnectTargetId(null);
    }
  }, [canvasTool]);

  useEffect(() => {
    if (canvasTool !== "shape") {
      setShapeMenuOpen(false);
    }
  }, [canvasTool]);

  useEffect(() => {
    if (!objectMenuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest("[data-canvas-object-popover]")) return;
      setObjectMenuOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [objectMenuOpen]);

  useEffect(() => {
    if (!connectMenuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest("[data-canvas-connect-popover]")) return;
      setConnectMenuOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [connectMenuOpen]);

  useEffect(() => {
    if (!shapeMenuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest("[data-canvas-shape-popover]")) return;
      setShapeMenuOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [shapeMenuOpen]);

  useEffect(() => {
    if (!canvasSketchColorMenuOpen && !canvasSketchLineStyleMenuOpen && !canvasSketchLineWeightMenuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest("[data-canvas-sketch-style-popover]")) return;
      setCanvasSketchColorMenuOpen(false);
      setCanvasSketchLineStyleMenuOpen(false);
      setCanvasSketchLineWeightMenuOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [canvasSketchColorMenuOpen, canvasSketchLineStyleMenuOpen, canvasSketchLineWeightMenuOpen]);

  useEffect(() => {
    if (showCanvasSketchStyleControls) return;
    setCanvasSketchColorMenuOpen(false);
    setCanvasSketchLineStyleMenuOpen(false);
    setCanvasSketchLineWeightMenuOpen(false);
  }, [showCanvasSketchStyleControls]);

  useEffect(() => {
    if (!cyContainerRef.current || cyRef.current) return;

    const cy = cytoscape({
      container: cyContainerRef.current,
      elements: graphElements,
      style: POSTGRES_EXPERIMENT_CYTOSCAPE_STYLESHEET,
      layout: { name: "preset" },
      minZoom: 0.4,
      maxZoom: 2.4,
      wheelSensitivity: 0.18,
      selectionType: "single",
      boxSelectionEnabled: false,
    });

    (cy as CytoscapeCore & { gridGuide: (options: Record<string, unknown>) => void }).gridGuide({
      snapToGridOnRelease: false,
      snapToGridDuringDrag: false,
      snapToAlignmentLocationOnRelease: false,
      snapToAlignmentLocationDuringDrag: false,
      distributionGuidelines: false,
      geometricGuideline: false,
      initPosAlignment: false,
      centerToEdgeAlignment: false,
      resize: false,
      parentPadding: false,
      drawGrid: true,
      gridSpacing: 28,
      snapToGridCenter: true,
      zoomDash: true,
      panGrid: true,
      gridStackOrder: 0,
      gridColor: "#dedede",
      lineWidth: 2,
      guidelinesStackOrder: 4,
      guidelinesTolerance: 2,
      guidelinesStyle: {
        strokeStyle: "#8b7d6b",
        geometricGuidelineRange: 400,
        range: 100,
        minDistRange: 10,
        distGuidelineOffset: 10,
        horizontalDistColor: "#ff0000",
        verticalDistColor: "#00ff00",
        initPosAlignmentColor: "#0000ff",
        lineDash: [0, 0],
        horizontalDistLine: [0, 0],
        verticalDistLine: [0, 0],
        initPosAlignmentLine: [0, 0],
      },
      parentSpacing: -1,
    });

    const restackGridCanvas = () => {
      const container = cyContainerRef.current;
      if (!container) return;

      const canvases = Array.from(container.querySelectorAll<HTMLCanvasElement>(":scope > canvas"));
      if (canvases.length === 0) return;

      const gridCanvas = canvases[canvases.length - 1];
      if (container.firstElementChild !== gridCanvas) {
        container.prepend(gridCanvas);
      }
      gridCanvas.style.zIndex = "0";
      gridCanvas.style.pointerEvents = "none";

      canvases.slice(0, -1).forEach((canvas, index) => {
        canvas.style.zIndex = String(index + 1);
      });
    };

    requestAnimationFrame(restackGridCanvas);
    window.setTimeout(restackGridCanvas, 0);

    cy.zoom(canvasScale);
    cy.pan(canvasOffset);
    cyRef.current = cy;

    const handleViewport = () => {
      if (syncingViewportRef.current) return;
      const zoom = cy.zoom();
      const pan = cy.pan();
      setCanvasScale((current) => (Math.abs(current - zoom) > 0.0001 ? zoom : current));
      setCanvasOffset((current) => (
        Math.abs(current.x - pan.x) > 0.5 || Math.abs(current.y - pan.y) > 0.5
          ? { x: pan.x, y: pan.y }
          : current
      ));
    };

    const handleNodeTap = (event: { target: { id: () => string } }) => {
      const nodeId = event.target.id();
      const latest = latestCanvasInteractionRef.current;
      if (!latest.isReadOnly && latest.canvasTool === "eraser") {
        hideCanvasObject(nodeId);
        return;
      }
      if (!latest.isReadOnly && latest.canvasTool === "connect") {
        if (!latest.canvasRelationshipTypeId) {
          setCanvasError("Choose a relationship type before connecting objects.");
          return;
        }
        setCanvasError("");
        setCanvasNotice("");
        setSelectedShapeId(null);
        setSelectedEdgeId(null);
        setSelectedNodeId(nodeId);
        setPendingConnectionSourceId((current) => {
          if (!current || current === nodeId) {
            return nodeId;
          }
          void handleConnectRef.current({ source: current, target: nodeId });
          return null;
        });
        return;
      }
      setSelectedNodeId(nodeId);
      setSelectedEdgeId(null);
      setSelectedShapeId(null);
      setCanvasNotice("");
      setCanvasError("");
    };

    const handleEdgeTap = (event: { target: { id: () => string } }) => {
      const edgeId = event.target.id();
      const latest = latestCanvasInteractionRef.current;
      if (!latest.isReadOnly && latest.canvasTool === "eraser") {
        hideCanvasRelationship(edgeId);
        return;
      }
      setSelectedEdgeId(edgeId);
      setSelectedNodeId(null);
      setSelectedShapeId(null);
      setCanvasNotice("");
      setCanvasError("");
    };

    const handleBackgroundTap = (event: { target: unknown }) => {
      if (event.target !== cy) return;
      const latest = latestCanvasInteractionRef.current;
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setSelectedShapeId(null);
      setPendingConnectionSourceId(null);
      setCanvasNotice("");
      if (latest.canvasTool === "select") {
        setInspectorCollapsed(true);
      }
    };

    const handleNodeDragFree = (event: { target: { id: () => string; position: () => { x: number; y: number } } }) => {
      const latest = latestCanvasInteractionRef.current;
      if (latest.isReadOnly || latest.canvasTool !== "select") return;
      const nodeId = event.target.id();
      const position = event.target.position();
      const nodeState = latest.canvasNodes[nodeId];
      if (!nodeState) return;
      commitCanvasNodePositionRef.current({
        id: nodeId,
        position: {
          x: position.x - nodeState.width / 2,
          y: position.y - nodeState.height / 2,
        },
      });
    };

    const handleNodeMouseOver = (event: { target: { id: () => string } }) => {
      const latest = latestCanvasInteractionRef.current;
      const nodeId = event.target.id();
      if (!latest.isReadOnly && latest.canvasTool === "eraser" && eraserInteractionRef.current.pointerId !== null) {
        if (!eraserInteractionRef.current.erasedNodeIds.has(nodeId)) {
          eraserInteractionRef.current.erasedNodeIds.add(nodeId);
          hideCanvasObject(nodeId);
        }
        return;
      }
      if (latest.isReadOnly || latest.canvasTool !== "connect" || !pendingConnectionSourceId || nodeId === pendingConnectionSourceId) {
        return;
      }
      setHoveredConnectTargetId(nodeId);
    };

    const handleEdgeMouseOver = (event: { target: { id: () => string } }) => {
      const latest = latestCanvasInteractionRef.current;
      const edgeId = event.target.id();
      if (!latest.isReadOnly && latest.canvasTool === "eraser" && eraserInteractionRef.current.pointerId !== null) {
        if (!eraserInteractionRef.current.erasedEdgeIds.has(edgeId)) {
          eraserInteractionRef.current.erasedEdgeIds.add(edgeId);
          hideCanvasRelationship(edgeId);
        }
      }
    };

    const handleNodeMouseOut = (event: { target: { id: () => string } }) => {
      const nodeId = event.target.id();
      setHoveredConnectTargetId((current) => (current === nodeId ? null : current));
    };

    cy.on("viewport", handleViewport);
    cy.on("tap", "node", handleNodeTap);
    cy.on("tap", "edge", handleEdgeTap);
    cy.on("tap", handleBackgroundTap);
    cy.on("dragfree", "node", handleNodeDragFree);
    cy.on("mouseover", "node", handleNodeMouseOver);
    cy.on("mouseover", "edge", handleEdgeMouseOver);
    cy.on("mouseout", "node", handleNodeMouseOut);

    return () => {
      cy.removeListener("viewport", undefined, handleViewport);
      cy.removeListener("tap", "node", handleNodeTap);
      cy.removeListener("tap", "edge", handleEdgeTap);
      cy.removeListener("tap", handleBackgroundTap);
      cy.removeListener("dragfree", "node", handleNodeDragFree);
      cy.removeListener("mouseover", "node", handleNodeMouseOver);
      cy.removeListener("mouseover", "edge", handleEdgeMouseOver);
      cy.removeListener("mouseout", "node", handleNodeMouseOut);
      cy.destroy();
      cyRef.current = null;
    };
  }, [pendingConnectionSourceId, setCanvasOffset, setCanvasScale]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().remove();
      cy.add(graphElements);
    });
  }, [graphElements]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const allowPanning = isReadOnly || canvasTool === "hand";
    cy.userPanningEnabled(allowPanning);
    cy.boxSelectionEnabled(canvasTool === "select");
    cy.autoungrabify(isReadOnly || canvasTool !== "select");
  }, [canvasTool, isReadOnly]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const currentZoom = cy.zoom();
    const currentPan = cy.pan();
    if (
      Math.abs(currentZoom - canvasScale) < 0.0001
      && Math.abs(currentPan.x - canvasOffset.x) < 0.5
      && Math.abs(currentPan.y - canvasOffset.y) < 0.5
    ) {
      return;
    }
    syncingViewportRef.current = true;
    cy.zoom(canvasScale);
    cy.pan(canvasOffset);
    window.setTimeout(() => {
      syncingViewportRef.current = false;
    }, 0);
  }, [canvasOffset, canvasScale]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().unselect();
      if (selectedNodeId) {
        cy.$id(selectedNodeId).select();
      }
      if (selectedEdgeId) {
        cy.$id(selectedEdgeId).select();
      }
    });
  }, [selectedEdgeId, selectedNodeId]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().removeClass("connect-source");
    cy.nodes().removeClass("connect-valid-target");
    cy.nodes().removeClass("connect-invalid-target");
    if (canvasTool === "connect" && pendingConnectionSourceId) {
      cy.$id(pendingConnectionSourceId).addClass("connect-source");
      const sourceObject = objectById.get(pendingConnectionSourceId) ?? null;
      cy.nodes().forEach((node) => {
        const nodeId = node.id();
        if (nodeId === pendingConnectionSourceId) return;
        const targetObject = objectById.get(nodeId) ?? null;
        const validFrom = !selectedRelationshipType?.fromObjectTypeIds?.length
          || !!sourceObject && selectedRelationshipType.fromObjectTypeIds.includes(sourceObject.objectTypeId);
        const validTo = !selectedRelationshipType?.toObjectTypeIds?.length
          || !!targetObject && selectedRelationshipType.toObjectTypeIds.includes(targetObject.objectTypeId);
        node.addClass(validFrom && validTo ? "connect-valid-target" : "connect-invalid-target");
      });
    }
  }, [canvasTool, objectById, pendingConnectionSourceId, selectedRelationshipType]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setPendingConnectionSourceId(null);
      setConnectPreviewWorld(null);
      setHoveredConnectTargetId(null);
      setEditingTextShapeId(null);
      setCanvasNotice("");
      setCanvasError("");
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!editingTextShapeId) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest("[data-canvas-text-editor-id], [data-text-editor-toolbar='true']")) return;
      setEditingTextShapeId(null);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [editingTextShapeId]);

  function screenToWorld(clientX: number, clientY: number) {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - canvasOffset.x) / canvasScale,
      y: (clientY - rect.top - canvasOffset.y) / canvasScale,
    };
  }

  function handleCanvasWheel(event: ReactWheelEvent<HTMLDivElement>) {
    const cy = cyRef.current;
    const viewport = viewportRef.current;
    if (!cy || !viewport) return;

    const target = event.target;
    if (
      target instanceof HTMLElement
      && target.closest("button, input, select, textarea, [role='menu'], [data-wheel-zoom-ignore='true']")
    ) {
      return;
    }

    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const zoomFactor = Math.exp(-event.deltaY * 0.0015);
    const nextZoom = Math.min(2.4, Math.max(0.4, cy.zoom() * zoomFactor));

    cy.zoom({
      level: nextZoom,
      renderedPosition: {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      },
    });
  }

  function getCanvasCenterWorld(): PostgresExperimentCanvasPoint {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 120, y: 120 };
    return {
      x: (rect.width / 2 - canvasOffset.x) / canvasScale,
      y: (rect.height / 2 - canvasOffset.y) / canvasScale,
    };
  }

  function addExistingObjectToCanvas(object: PostgresExperimentObject, preferredPosition?: PostgresExperimentCanvasPoint) {
    const targetPosition = preferredPosition ?? getCanvasCenterWorld();
    const objectTypeRecord = objectTypeById.get(object.objectTypeId) ?? null;
    const shape = getPostgresExperimentObjectAppearance(object, objectTypeRecord).shape;
    const defaultDimensions = getCanvasNodeDefaultDimensions(shape);
    setCanvasNodes((current) => ({
      ...current,
      [object.id]: {
        id: object.id,
        x: targetPosition.x,
        y: targetPosition.y,
        width: current[object.id]?.width ?? defaultDimensions.width,
        height: current[object.id]?.height ?? defaultDimensions.height,
      },
    }));
    setSelectedNodeId(object.id);
    setSelectedEdgeId(null);
    setSelectedShapeId(null);
    setCanvasNotice(canvasNodes[object.id] ? `Moved "${object.title}" on the canvas.` : `Added "${object.title}" to the canvas.`);
    setCanvasError("");
  }

  function addExistingRelationshipToCanvas(
    relationship: PostgresExperimentRelationship,
    preferredPosition?: PostgresExperimentCanvasPoint,
  ) {
    const center = preferredPosition ?? getCanvasCenterWorld();
    const sourceObject = objectById.get(relationship.fromObjectId) ?? null;
    const targetObject = objectById.get(relationship.toObjectId) ?? null;
    setCanvasNodes((current) => {
      const next = { ...current };

      const placeObject = (
        object: PostgresExperimentObject | null,
        objectId: string,
        fallbackX: number,
        fallbackY: number,
      ) => {
        if (!object || next[objectId]) return;
        const objectTypeRecord = objectTypeById.get(object.objectTypeId) ?? null;
        const shape = getPostgresExperimentObjectAppearance(object, objectTypeRecord).shape;
        const defaultDimensions = getCanvasNodeDefaultDimensions(shape);
        next[objectId] = {
          id: objectId,
          x: fallbackX,
          y: fallbackY,
          width: defaultDimensions.width,
          height: defaultDimensions.height,
        };
      };

      placeObject(sourceObject, relationship.fromObjectId, center.x - 220, center.y - 20);
      placeObject(targetObject, relationship.toObjectId, center.x + 80, center.y - 20);
      return next;
    });
    setHiddenCanvasRelationshipIds((current) => current.filter((id) => id !== relationship.id));
    setSelectedEdgeId(relationship.id);
    setSelectedNodeId(null);
    setSelectedShapeId(null);
    setCanvasNotice(`Added relationship "${relationship.relationshipType}" to the canvas.`);
    setCanvasError("");
  }

  function shouldIgnoreCanvasPointerTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return !!target.closest(
      ".nopan, button, select, input, textarea, option, [contenteditable='true'], [data-text-editor-toolbar='true']",
    );
  }

  function updateCanvasTextShape(shapeId: string, updater: (shape: Extract<PostgresExperimentCanvasShape, { kind: "text" }>) => Extract<PostgresExperimentCanvasShape, { kind: "text" }>) {
    setCanvasShapes((current) => current.map((shape) => (
      shape.id === shapeId && shape.kind === "text" ? updater(shape) : shape
    )));
  }

  function beginEditingCanvasText(shapeId: string) {
    setSelectedShapeId(shapeId);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setEditingTextShapeId(shapeId);
  }

  function focusCanvasTextEditor(..._args: unknown[]) {
    // Text editing now uses Tiptap and focuses within the editor component.
  }

  function applyCanvasTextCommand(..._args: unknown[]) {
    // Text formatting now runs through the Tiptap editor instance.
  }

  function handleCanvasPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if (shouldIgnoreCanvasPointerTarget(event.target)) return;

    if (canvasTool === "select") {
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setSelectedShapeId(null);
      setPendingConnectionSourceId(null);
      setCanvasNotice("");
      setInspectorCollapsed(true);
    }

    if (isReadOnly) return;

    if (canvasTool === "eraser") {
      eraserInteractionRef.current = {
        pointerId: event.pointerId,
        erasedShapeIds: new Set<string>(),
        erasedNodeIds: new Set<string>(),
        erasedEdgeIds: new Set<string>(),
      };
      viewportRef.current?.setPointerCapture(event.pointerId);
      eraseCanvasItemsAtClientPoint(event.clientX, event.clientY);
      return;
    }

    if (canvasTool !== "pen" && canvasTool !== "shape" && canvasTool !== "text") return;

    const world = screenToWorld(event.clientX, event.clientY);
    if (canvasTool === "pen") {
      const shapeId = crypto.randomUUID();
      setCanvasShapes((current) => [
        ...current,
        {
          id: shapeId,
          kind: "pen",
          points: [world],
          color: canvasSketchColor,
          lineStyle: canvasSketchLineStyle,
          strokeWidth: getPostgresExperimentRelationshipStrokeWidth(canvasSketchLineWeight),
        },
      ]);
      interactionRef.current = {
        ...interactionRef.current,
        mode: "draw-pen",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startWorldX: world.x,
        startWorldY: world.y,
        shapeId,
        initialShape: null,
        resizeHandle: null,
      };
      viewportRef.current?.setPointerCapture(event.pointerId);
      return;
    }

    if (canvasTool === "shape") {
      const shapeId = crypto.randomUUID();
      setCanvasShapes((current) => [
        ...current,
        {
          id: shapeId,
          kind: "shape",
          shape: canvasSketchShape,
          x: world.x,
          y: world.y,
          width: 1,
          height: 1,
          color: canvasSketchColor,
          fill: "filled",
          lineStyle: canvasSketchLineStyle,
          strokeWidth: getPostgresExperimentRelationshipStrokeWidth(canvasSketchLineWeight),
        },
      ]);
      interactionRef.current = {
        ...interactionRef.current,
        mode: "draw-shape",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startWorldX: world.x,
        startWorldY: world.y,
        shapeId,
        initialShape: null,
        resizeHandle: null,
      };
      viewportRef.current?.setPointerCapture(event.pointerId);
      return;
    }

    if (canvasTool === "text") {
      const shapeId = crypto.randomUUID();
      setCanvasShapes((current) => [
        ...current,
        {
          id: shapeId,
          kind: "text",
          x: world.x,
          y: world.y,
          width: 220,
          height: 96,
          color: "#1f2933",
          strokeWidth: 1,
          html: "<div>Text</div>",
          fontSize: 18,
          textAlign: "left",
        },
      ]);
      setCanvasNotice("");
      setCanvasError("");
      beginEditingCanvasText(shapeId);
    }
  }

  function handleCanvasPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (
      !isReadOnly
      && canvasTool === "eraser"
      && eraserInteractionRef.current.pointerId === event.pointerId
    ) {
      eraseCanvasItemsAtClientPoint(event.clientX, event.clientY);
      return;
    }

    const world = screenToWorld(event.clientX, event.clientY);
    if (canvasTool === "connect" && pendingConnectionSourceId) {
      setConnectPreviewWorld(world);
    }

    const interaction = interactionRef.current;
    if (interaction.pointerId !== event.pointerId) return;

    if (interaction.mode === "draw-pen" && interaction.shapeId) {
      setCanvasShapes((current) =>
        current.map((shape) =>
          shape.id === interaction.shapeId && shape.kind === "pen"
            ? { ...shape, points: [...shape.points, world] }
            : shape,
        ),
      );
      return;
    }

    if (interaction.mode === "draw-shape" && interaction.shapeId) {
      setCanvasShapes((current) =>
        current.map((shape) => {
          if (shape.id !== interaction.shapeId || (shape.kind !== "rectangle" && shape.kind !== "shape")) return shape;
          return {
            ...shape,
            x: Math.min(interaction.startWorldX, world.x),
            y: Math.min(interaction.startWorldY, world.y),
            width: Math.abs(world.x - interaction.startWorldX),
            height: Math.abs(world.y - interaction.startWorldY),
          };
        }),
      );
      return;
    }

    if (interaction.mode === "move-shape" && interaction.shapeId && interaction.initialShape) {
      const deltaX = world.x - interaction.startWorldX;
      const deltaY = world.y - interaction.startWorldY;
      setCanvasShapes((current) =>
        current.map((shape) =>
          shape.id === interaction.shapeId ? translateCanvasShape(interaction.initialShape as PostgresExperimentCanvasShape, deltaX, deltaY) : shape,
        ),
      );
      return;
    }

    if (interaction.mode === "resize-shape" && interaction.shapeId && interaction.initialShape && interaction.resizeHandle) {
      const resizeHandle = interaction.resizeHandle;
      setCanvasShapes((current) =>
        current.map((shape) => {
          if (shape.id !== interaction.shapeId) return shape;
          if (interaction.initialShape?.kind !== "rectangle" && interaction.initialShape?.kind !== "shape" && interaction.initialShape?.kind !== "text") return shape;
          return resizeCanvasBoxShape(interaction.initialShape, resizeHandle, world.x, world.y);
        }),
      );
    }
  }

  function endInteraction(pointerId: number, currentTarget: HTMLDivElement) {
    if (eraserInteractionRef.current.pointerId === pointerId) {
      try {
        currentTarget.releasePointerCapture(pointerId);
      } catch {
        // ignore
      }
      eraserInteractionRef.current = {
        pointerId: null,
        erasedShapeIds: new Set<string>(),
        erasedNodeIds: new Set<string>(),
        erasedEdgeIds: new Set<string>(),
      };
    }
    if (interactionRef.current.pointerId !== pointerId) return;
    try {
      currentTarget.releasePointerCapture(pointerId);
    } catch {
      // ignore
    }
    interactionRef.current = {
      ...interactionRef.current,
      mode: "idle",
      pointerId: null,
      shapeId: null,
      initialShape: null,
      resizeHandle: null,
    };
  }

  const connectPreviewSourceNode = pendingConnectionSourceId
    ? canvasNodes[pendingConnectionSourceId] ?? null
    : null;
  const connectPreviewTargetNode = hoveredConnectTargetId
    ? canvasNodes[hoveredConnectTargetId] ?? null
    : null;
  const connectPreviewSourceObject = pendingConnectionSourceId
    ? objectById.get(pendingConnectionSourceId) ?? null
    : null;
  const connectPreviewTargetObject = hoveredConnectTargetId
    ? objectById.get(hoveredConnectTargetId) ?? null
    : null;

  function beginCanvasShapeMove(
    event: React.PointerEvent<Element>,
    shape: PostgresExperimentCanvasShape,
  ) {
    if (isReadOnly || canvasTool !== "select") return;
    event.preventDefault();
    event.stopPropagation();
    const world = screenToWorld(event.clientX, event.clientY);
    interactionRef.current = {
      ...interactionRef.current,
      mode: "move-shape",
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWorldX: world.x,
      startWorldY: world.y,
      shapeId: shape.id,
      initialShape: shape,
      resizeHandle: null,
    };
    setSelectedShapeId(shape.id);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setEditingTextShapeId(null);
    viewportRef.current?.setPointerCapture(event.pointerId);
  }

  function beginCanvasShapeResize(
    event: React.PointerEvent<SVGCircleElement>,
    shape: Extract<PostgresExperimentCanvasShape, { kind: "rectangle" | "shape" | "text" }>,
    resizeHandle: "nw" | "ne" | "sw" | "se",
  ) {
    if (isReadOnly || canvasTool !== "select") return;
    event.preventDefault();
    event.stopPropagation();
    const world = screenToWorld(event.clientX, event.clientY);
    interactionRef.current = {
      ...interactionRef.current,
      mode: "resize-shape",
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWorldX: world.x,
      startWorldY: world.y,
      shapeId: shape.id,
      initialShape: shape,
      resizeHandle,
    };
    setSelectedShapeId(shape.id);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    viewportRef.current?.setPointerCapture(event.pointerId);
  }

  function deleteCanvasShape(shapeId: string) {
    setCanvasShapes((current) => current.filter((shape) => shape.id !== shapeId));
    setSelectedShapeId((current) => (current === shapeId ? null : current));
    setCanvasError("");
  }

  function eraseCanvasItemsAtClientPoint(clientX: number, clientY: number) {
    if (isReadOnly || canvasTool !== "eraser") return;

    const eraserState = eraserInteractionRef.current;
    const world = screenToWorld(clientX, clientY);

    const hitShape = canvasShapes.find((shape) =>
      !eraserState.erasedShapeIds.has(shape.id) && isWorldPointInsideCanvasShape(shape, world),
    );
    if (hitShape) {
      eraserState.erasedShapeIds.add(hitShape.id);
      deleteCanvasShape(hitShape.id);
    }
  }

  function hideCanvasObject(objectId: string) {
    setCanvasNodes((current) => {
      if (!(objectId in current)) return current;
      const next = { ...current };
      delete next[objectId];
      return next;
    });
    setSelectedNodeId((current) => (current === objectId ? null : current));
    setSelectedEdgeId(null);
    setSelectedShapeId(null);
    setCanvasNotice("Object removed from canvas.");
    setCanvasError("");
  }

  function hideCanvasRelationship(relationshipId: string) {
    setHiddenCanvasRelationshipIds((current) => (
      current.includes(relationshipId) ? current : [...current, relationshipId]
    ));
    setSelectedEdgeId((current) => (current === relationshipId ? null : current));
    setSelectedNodeId(null);
    setSelectedShapeId(null);
    setCanvasNotice("Relationship removed from canvas.");
    setCanvasError("");
  }

  function buildUpdatedCanvasNodes(
    current: Record<string, PostgresExperimentCanvasNodeState>,
    node: { id: string; position: { x: number; y: number } },
  ) {
    const object = objectById.get(node.id) ?? null;
    const objectTypeRecord = object ? objectTypeById.get(object.objectTypeId) ?? null : null;
    const shape = object ? getPostgresExperimentObjectAppearance(object, objectTypeRecord).shape : "rectangle";
    const defaultDimensions = getCanvasNodeDefaultDimensions(shape);
    return {
      ...current,
      [node.id]: {
        id: node.id,
        x: node.position.x,
        y: node.position.y,
        width: current[node.id]?.width ?? defaultDimensions.width,
        height: current[node.id]?.height ?? defaultDimensions.height,
      },
    };
  }

  function commitCanvasNodePosition(node: { id: string; position: { x: number; y: number } }) {
    setCanvasNodes((current) => buildUpdatedCanvasNodes(current, node));
  }

  async function handleConnect(connection: { source?: string | null; target?: string | null }) {
    if (isReadOnly) return;
    setCanvasError("");
    setCanvasNotice("");
    const sourceId = connection.source?.trim() ?? "";
    const targetId = connection.target?.trim() ?? "";
    if (!sourceId || !targetId) {
      setCanvasError("Choose two objects to connect.");
      return;
    }
    if (!canvasRelationshipTypeId) {
      setCanvasError("Choose a relationship type before connecting objects.");
      return;
    }

    const sourceObject = objectById.get(sourceId) ?? null;
    const targetObject = objectById.get(targetId) ?? null;
    if (!sourceObject || !targetObject) {
      setCanvasError("Could not resolve the selected objects.");
      return;
    }

    if (
      selectedRelationshipType?.fromObjectTypeIds?.length
      && !selectedRelationshipType.fromObjectTypeIds.includes(sourceObject.objectTypeId)
    ) {
      setCanvasError(`"${selectedRelationshipType.name}" must start from ${selectedRelationshipType.fromObjectTypes.join(", ") || "the required object type"}.`);
      return;
    }
    if (
      selectedRelationshipType?.toObjectTypeIds?.length
      && !selectedRelationshipType.toObjectTypeIds.includes(targetObject.objectTypeId)
    ) {
      setCanvasError(`"${selectedRelationshipType.name}" must end at ${selectedRelationshipType.toObjectTypes.join(", ") || "the required object type"}.`);
      return;
    }

    try {
      const created = await savePostgresExperimentRelationship({
        projectId,
        relationshipId: null,
        fromObjectId: sourceId,
        toObjectId: targetId,
        relationshipTypeId: canvasRelationshipTypeId,
        description: "",
        lineShapeOverride: null,
        lineWeightOverride: null,
        arrowheadOverride: null,
        colorOverride: null,
        attributeValues: [],
      });
      setRelationships((current) => [...current, created]);
      setPendingConnectionSourceId(null);
      setConnectPreviewWorld(null);
      setHoveredConnectTargetId(null);
      setSelectedNodeId(null);
      setSelectedEdgeId(created.id);
      setCanvasNotice(`Created relationship "${created.relationshipType}".`);
    } catch (error) {
      setCanvasError(error instanceof Error ? error.message : String(error));
    }
  }

  commitCanvasNodePositionRef.current = commitCanvasNodePosition;
  handleConnectRef.current = handleConnect;

  return (
    <div className="view users-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>{isReadOnly ? "Saved Canvas" : "Free Draw"}</h1>
          <p className="auth-hint" style={{ margin: "6px 0 0" }}>
            {savedCanvasSession
              ? `${isReadOnly ? "Viewing" : "Editing"} saved canvas: ${savedCanvasSession.name}`
              : "Build a visual workspace from research objects and connect them directly on the canvas."}
          </p>
        </div>
        <div className="view-header-actions">
          {!isReadOnly ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void onSaveDrawing()}
              disabled={freeDrawSaving}
            >
              {freeDrawSaving ? "Saving..." : "Save drawing"}
            </button>
          ) : null}
        </div>
      </header>
      {freeDrawSaveNotice ? <p className="settings-success">{freeDrawSaveNotice}</p> : null}
      {canvasNotice ? <p className="settings-success">{canvasNotice}</p> : null}
      {canvasError ? <p className="users-error">{canvasError}</p> : null}
      {canvasSaveError ? <p className="users-error">Could not save canvas state: {canvasSaveError}</p> : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 18, flex: 1, minHeight: 0 }}>
        <div
          ref={viewportRef}
          onWheel={handleCanvasWheel}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerLeave={() => {
            if (canvasTool === "connect") {
              setConnectPreviewWorld(null);
            }
          }}
          onPointerUp={(event) => endInteraction(event.pointerId, event.currentTarget)}
          onPointerCancel={(event) => endInteraction(event.pointerId, event.currentTarget)}
          style={{
            position: "relative",
            minHeight: 0,
            overflow: "hidden",
            borderRadius: 20,
            border: "1px solid rgba(53, 80, 112, 0.14)",
             background: "radial-gradient(circle at top, rgba(189, 224, 254, 0.18), rgba(255, 255, 255, 0.98) 52%)",
             cursor: canvasTool === "pen" || canvasTool === "shape"
               ? "crosshair"
               : canvasTool === "eraser"
                ? "crosshair"
                : "default",
           }}
         >
          <div
            ref={cyContainerRef}
            style={{
              position: "absolute",
              inset: 0,
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              zIndex: 1,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                transform: `translate(${canvasOffset.x}px, ${canvasOffset.y}px) scale(${canvasScale})`,
                transformOrigin: "top left",
              }}
            >
              {canvasShapes.filter((shape) => shape.kind === "text").map((shape) => {
                const isSelected = shape.id === selectedShapeId;
                const isEditing = shape.id === editingTextShapeId;
                if (isEditing) {
                  return (
                    <div
                      key={shape.id}
                      style={{
                        position: "absolute",
                        left: shape.x,
                        top: shape.y,
                        width: shape.width,
                        minHeight: shape.height,
                        pointerEvents: "auto",
                      }}
                    >
                      <CanvasRichTextEditor
                        shape={shape}
                        canvasScale={canvasScale}
                        isReadOnly={isReadOnly}
                        canvasTool={canvasTool}
                        onBeginMove={beginCanvasShapeMove}
                        onBeginEditing={beginEditingCanvasText}
                        onDelete={deleteCanvasShape}
                        onSelect={() => {
                          setSelectedShapeId(shape.id);
                          setSelectedNodeId(null);
                          setSelectedEdgeId(null);
                        }}
                        onUpdate={(updater) => {
                          updateCanvasTextShape(shape.id, updater);
                        }}
                      />
                    </div>
                  );
                }
                return (
                  <div
                    key={shape.id}
                    style={{
                      position: "absolute",
                      left: shape.x,
                      top: shape.y,
                      width: shape.width,
                      minHeight: shape.height,
                      pointerEvents: "auto",
                    }}
                  >
                    {isEditing ? (
                      <div
                        data-text-editor-toolbar="true"
                        style={{
                          position: "absolute",
                          left: 0,
                          bottom: "calc(100% + 8px)",
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
                          zIndex: 4,
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        {[
                          { label: "B", command: "bold" },
                          { label: "I", command: "italic" },
                          { label: "U", command: "underline" },
                          { label: "•", command: "insertUnorderedList" },
                          { label: "1.", command: "insertOrderedList" },
                          { label: "Tx", command: "removeFormat" },
                        ].map((item) => (
                          <button
                            key={item.command}
                            type="button"
                            className="btn btn--ghost"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              applyCanvasTextCommand(item.command);
                            }}
                            style={{ minWidth: 32, height: 32, padding: "0 8px", justifyContent: "center" }}
                          >
                            {item.label}
                          </button>
                        ))}
                        <div style={{ width: 1, alignSelf: "stretch", background: "rgba(53, 80, 112, 0.12)" }} />
                        {([
                          { label: "L", value: "left" },
                          { label: "C", value: "center" },
                          { label: "R", value: "right" },
                        ] as const).map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className="btn btn--ghost"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              updateCanvasTextShape(shape.id, (current) => ({ ...current, textAlign: option.value }));
                              focusCanvasTextEditor(shape.id);
                            }}
                            style={{
                              minWidth: 32,
                              height: 32,
                              padding: "0 8px",
                              justifyContent: "center",
                              background: shape.textAlign === option.value ? "rgba(53, 80, 112, 0.10)" : undefined,
                            }}
                          >
                            {option.label}
                          </button>
                        ))}
                        <select
                          value={String(shape.fontSize)}
                          onMouseDown={(event) => event.stopPropagation()}
                          onChange={(event) => {
                            const nextFontSize = Number(event.target.value);
                            updateCanvasTextShape(shape.id, (current) => ({ ...current, fontSize: nextFontSize }));
                            focusCanvasTextEditor(shape.id);
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
                            <option key={fontSize} value={fontSize}>{fontSize}px</option>
                          ))}
                        </select>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <input
                            className="form-input form-input--color"
                            type="color"
                            value={shape.color}
                            aria-label="Text color"
                            onMouseDown={(event) => event.stopPropagation()}
                            onChange={(event) => {
                              const nextColor = event.target.value;
                              updateCanvasTextShape(shape.id, (current) => ({ ...current, color: nextColor }));
                              applyCanvasTextCommand("foreColor", nextColor);
                            }}
                            style={{ width: 36, minWidth: 36, height: 32, padding: 3 }}
                          />
                          <input
                            className="form-input"
                            value={shape.color}
                            aria-label="Text color hex value"
                            onMouseDown={(event) => event.stopPropagation()}
                            onChange={(event) => {
                              const nextColor = normalizePostgresExperimentObjectTypeColor(event.target.value);
                              updateCanvasTextShape(shape.id, (current) => ({ ...current, color: nextColor }));
                              applyCanvasTextCommand("foreColor", nextColor);
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
                    ) : null}
                    <div
                      data-canvas-text-editor-id={shape.id}
                      contentEditable={isEditing && !isReadOnly}
                      suppressContentEditableWarning
                      dangerouslySetInnerHTML={{ __html: normalizeCanvasTextHtml(shape.html) }}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        if (canvasTool === "eraser") {
                          deleteCanvasShape(shape.id);
                          return;
                        }
                        if (canvasTool === "text") {
                          beginEditingCanvasText(shape.id);
                          return;
                        }
                        if (canvasTool === "select" && !isEditing) {
                          beginCanvasShapeMove(event, shape);
                          return;
                        }
                        setSelectedShapeId(shape.id);
                        setSelectedNodeId(null);
                        setSelectedEdgeId(null);
                      }}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        if (!isReadOnly) {
                          beginEditingCanvasText(shape.id);
                        }
                      }}
                      onInput={(event) => {
                        const html = normalizeCanvasTextHtml(event.currentTarget.innerHTML);
                        updateCanvasTextShape(shape.id, (current) => ({ ...current, html }));
                      }}
                      onBlur={(event) => {
                        const html = normalizeCanvasTextHtml(event.currentTarget.innerHTML);
                        updateCanvasTextShape(shape.id, (current) => ({ ...current, html }));
                      }}
                      style={{
                        minHeight: shape.height,
                        padding: "6px 8px",
                        outline: "none",
                        borderRadius: 8,
                        border: isEditing
                          ? "1px solid rgba(53, 80, 112, 0.28)"
                          : isSelected
                            ? "1px solid rgba(214, 40, 40, 0.25)"
                            : "1px solid transparent",
                        background: isEditing || isSelected ? "rgba(255, 255, 255, 0.86)" : "transparent",
                        color: shape.color,
                        fontSize: shape.fontSize,
                        lineHeight: 1.35,
                        textAlign: shape.textAlign,
                        whiteSpace: "normal",
                        cursor: canvasTool === "select" && !isEditing ? "grab" : "text",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
          <div
            style={{
              position: "absolute",
              left: 16,
              bottom: 16,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              zIndex: 2,
            }}
          >
            <div
              style={{
                width: canvasToolsCollapsed ? 56 : 296,
                transition: "width 160ms ease",
                overflow: canvasToolsCollapsed ? "hidden" : "visible",
                boxShadow: "0 18px 36px rgba(53, 80, 112, 0.10)",
                border: "1px solid rgba(53, 80, 112, 0.12)",
                borderRadius: 18,
                background: "rgba(255, 255, 255, 0.94)",
                backdropFilter: "blur(10px)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: canvasToolsCollapsed ? 10 : 12,
                  borderBottom: canvasToolsCollapsed ? "none" : "1px solid rgba(53, 80, 112, 0.10)",
                }}
              >
                {canvasToolsCollapsed ? null : <div className="auth-hint">Canvas tools</div>}
                <button
                  type="button"
                  className="btn"
                  onClick={() => setCanvasToolsCollapsed((current) => !current)}
                  aria-label={canvasToolsCollapsed ? "Open canvas tools" : "Collapse canvas tools"}
                  title={canvasToolsCollapsed ? "Open canvas tools" : "Collapse canvas tools"}
                  style={{
                    minWidth: 36,
                    width: 36,
                    height: 36,
                    padding: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {canvasToolsCollapsed ? ">" : "<"}
                </button>
              </div>
              {canvasToolsCollapsed ? null : (
                  <div style={{ padding: 12 }}>
                    <div
                      style={{
                        display: "grid",
                      gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                      gap: 8,
                    }}
                  >
                    {([
                      "select",
                      "hand",
                      !isReadOnly ? "create-object" : null,
                      "connect",
                      !isReadOnly ? "pen" : null,
                      !isReadOnly ? "shape" : null,
                      !isReadOnly ? "text" : null,
                      !isReadOnly ? "eraser" : null,
                    ].filter(Boolean) as Array<PostgresExperimentCanvasTool | "create-object">).map((tool) => {
                    if (tool === "create-object") {
                      return (
                        <div
                          key={tool}
                          data-canvas-object-popover="anchor"
                          style={{
                            position: "relative",
                          }}
                        >
                          <button
                            type="button"
                            className="btn btn--ghost"
                            onClick={() => {
                              setObjectMenuOpen((current) => !current);
                              setConnectMenuOpen(false);
                              setShapeMenuOpen(false);
                              setCanvasSketchColorMenuOpen(false);
                              setCanvasSketchLineStyleMenuOpen(false);
                              setCanvasSketchLineWeightMenuOpen(false);
                            }}
                            title="Object options"
                            aria-label="Object options"
                            aria-haspopup="menu"
                            aria-expanded={objectMenuOpen}
                            style={{
                              width: "100%",
                              minHeight: 68,
                              padding: "10px 8px",
                              borderRadius: 14,
                              border: objectMenuOpen ? "1px solid rgba(53, 80, 112, 0.08)" : "1px solid rgba(53, 80, 112, 0.12)",
                              background: objectMenuOpen ? "#355070" : "rgba(53, 80, 112, 0.04)",
                              color: objectMenuOpen ? "#ffffff" : "#355070",
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 4,
                              textAlign: "center",
                              boxShadow: objectMenuOpen ? "0 12px 24px rgba(53, 80, 112, 0.20)" : "none",
                            }}
                          >
                            <span
                              style={{
                                position: "relative",
                                width: 24,
                                height: 24,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <ObjectShapeSwatch
                                shape="rounded"
                                fill="outline"
                                color={objectMenuOpen ? "#ffffff" : "#355070"}
                                width={22}
                                minHeight={18}
                              />
                              <span
                                aria-hidden="true"
                                style={{
                                  position: "absolute",
                                  right: -6,
                                  bottom: -6,
                                  width: 12,
                                  height: 12,
                                  borderRadius: 999,
                                  background: objectMenuOpen ? "#ffffff" : "#355070",
                                  color: objectMenuOpen ? "#355070" : "#ffffff",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: 10,
                                  fontWeight: 700,
                                  lineHeight: 1,
                                }}
                              >
                                +
                              </span>
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.1 }}>Object</span>
                          </button>
                          {objectMenuOpen ? (
                            <div
                              role="menu"
                              data-canvas-object-popover="menu"
                              style={{
                                position: "absolute",
                                left: 0,
                                bottom: "calc(100% + 10px)",
                                width: "max-content",
                                padding: 10,
                                borderRadius: 16,
                                border: "1px solid rgba(53, 80, 112, 0.14)",
                                background: "rgba(255, 255, 255, 0.98)",
                                boxShadow: "0 18px 40px rgba(15, 23, 42, 0.16)",
                                backdropFilter: "blur(10px)",
                                zIndex: 5,
                              }}
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => event.stopPropagation()}
                            >
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                                  gap: 8,
                                }}
                              >
                                <button
                                  type="button"
                                  className="btn btn--ghost"
                                  title="Add an existing object"
                                  aria-label="Add an existing object"
                                  onClick={() => {
                                    setExistingObjectsModalOpen(true);
                                    setObjectMenuOpen(false);
                                    setConnectMenuOpen(false);
                                  }}
                                  style={{
                                    width: 40,
                                    minWidth: 40,
                                    height: 40,
                                    padding: 0,
                                    borderRadius: 12,
                                    border: "1px solid rgba(53, 80, 112, 0.12)",
                                    background: "rgba(53, 80, 112, 0.04)",
                                    color: "#355070",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 18,
                                    fontWeight: 700,
                                  }}
                                >
                                  O
                                </button>
                                <button
                                  type="button"
                                  className="btn btn--ghost"
                                  title="Create a new object"
                                  aria-label="Create a new object"
                                  onClick={() => {
                                    onCreateObjectAt(undefined, getCanvasCenterWorld());
                                    setObjectMenuOpen(false);
                                    setConnectMenuOpen(false);
                                  }}
                                  style={{
                                    width: 40,
                                    minWidth: 40,
                                    height: 40,
                                    padding: 0,
                                    borderRadius: 12,
                                    border: "1px solid rgba(53, 80, 112, 0.12)",
                                    background: "rgba(53, 80, 112, 0.04)",
                                    color: "#355070",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 18,
                                    fontWeight: 700,
                                  }}
                                >
                                  +
                                </button>
                                <button
                                  type="button"
                                  className="btn btn--ghost"
                                  title="Create a new object type"
                                  aria-label="Create a new object type"
                                  onClick={() => {
                                    onOpenCreateObjectType();
                                    setObjectMenuOpen(false);
                                    setConnectMenuOpen(false);
                                  }}
                                  style={{
                                    width: 40,
                                    minWidth: 40,
                                    height: 40,
                                    padding: 0,
                                    borderRadius: 12,
                                    border: "1px solid rgba(53, 80, 112, 0.12)",
                                    background: "rgba(53, 80, 112, 0.04)",
                                    color: "#355070",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 18,
                                    fontWeight: 700,
                                  }}
                                >
                                  T
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    }

                    const meta = getCanvasToolButtonMeta(tool);
                    const isActive = canvasTool === tool;
                    const isShapeTool = tool === "shape" && !isReadOnly;
                    const isConnectTool = tool === "connect" && !isReadOnly;
                    return (
                      <div
                        key={tool}
                        data-canvas-shape-popover={isShapeTool ? "anchor" : undefined}
                        data-canvas-connect-popover={isConnectTool ? "anchor" : undefined}
                        style={{
                          position: "relative",
                        }}
                      >
                        <button
                          type="button"
                          className="btn btn--ghost"
                          onClick={() => {
                            setObjectMenuOpen(false);
                            setCanvasSketchColorMenuOpen(false);
                            setCanvasSketchLineStyleMenuOpen(false);
                            setCanvasSketchLineWeightMenuOpen(false);
                            if (tool === "connect") {
                              setConnectMenuOpen((current) => !current);
                              setShapeMenuOpen(false);
                              return;
                            }
                            setCanvasTool(tool);
                            setConnectMenuOpen(false);
                            if (tool === "shape") {
                              setShapeMenuOpen((current) => !current || canvasTool !== "shape");
                            } else {
                              setShapeMenuOpen(false);
                            }
                          }}
                          title={meta.hint}
                          aria-label={meta.label}
                          aria-haspopup={isShapeTool || isConnectTool ? "menu" : undefined}
                          aria-expanded={isShapeTool ? shapeMenuOpen : isConnectTool ? connectMenuOpen : undefined}
                          style={{
                            width: "100%",
                            minHeight: 68,
                            padding: "10px 8px",
                            borderRadius: 14,
                            border: (isConnectTool ? connectMenuOpen || isActive : isActive) ? "1px solid rgba(53, 80, 112, 0.08)" : "1px solid rgba(53, 80, 112, 0.12)",
                            background: (isConnectTool ? connectMenuOpen || isActive : isActive) ? "#355070" : "rgba(53, 80, 112, 0.04)",
                            color: (isConnectTool ? connectMenuOpen || isActive : isActive) ? "#ffffff" : "#355070",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 4,
                            textAlign: "center",
                            boxShadow: (isConnectTool ? connectMenuOpen || isActive : isActive) ? "0 12px 24px rgba(53, 80, 112, 0.20)" : "none",
                          }}
                        >
                          {tool === "shape" ? (
                            <span
                              style={{
                                position: "relative",
                                width: 24,
                                height: 24,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <ObjectShapeSwatch
                                shape={canvasSketchShape}
                                fill="outline"
                                color={isActive ? "#ffffff" : "#355070"}
                                width={22}
                                minHeight={18}
                              />
                            </span>
                          ) : tool === "connect" ? (
                            <svg
                              width="22"
                              height="22"
                              viewBox="0 0 22 22"
                              fill="none"
                              aria-hidden="true"
                              style={{ display: "block" }}
                            >
                              <circle cx="6" cy="6" r="2.5" fill="currentColor" />
                              <circle cx="16" cy="11" r="2.5" fill="currentColor" />
                              <circle cx="6" cy="16" r="2.5" fill="currentColor" />
                              <path
                                d="M8.1 6.7L13.8 10.3M8.1 15.3L13.8 11.7"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                              />
                            </svg>
                          ) : (
                            <span style={{ fontSize: 20, lineHeight: 1 }}>{meta.icon}</span>
                          )}
                          <span style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.1 }}>{meta.label}</span>
                        </button>
                        {isConnectTool && connectMenuOpen ? (
                          <div
                            role="menu"
                            data-canvas-connect-popover="menu"
                            style={{
                              position: "absolute",
                              left: 0,
                              bottom: "calc(100% + 10px)",
                              width: "max-content",
                              padding: 10,
                              borderRadius: 16,
                              border: "1px solid rgba(53, 80, 112, 0.14)",
                              background: "rgba(255, 255, 255, 0.98)",
                              boxShadow: "0 18px 40px rgba(15, 23, 42, 0.16)",
                              backdropFilter: "blur(10px)",
                              zIndex: 5,
                            }}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                                gap: 8,
                              }}
                            >
                              <button
                                type="button"
                                className="btn btn--ghost"
                                title="Add an existing relationship"
                                aria-label="Add an existing relationship"
                                onClick={() => {
                                  setExistingRelationshipsModalOpen(true);
                                  setConnectMenuOpen(false);
                                }}
                                style={{
                                  width: 40,
                                  minWidth: 40,
                                  height: 40,
                                  padding: 0,
                                  borderRadius: 12,
                                  border: "1px solid rgba(53, 80, 112, 0.12)",
                                  background: "rgba(53, 80, 112, 0.04)",
                                  color: "#355070",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: 16,
                                  fontWeight: 700,
                                }}
                              >
                                R
                              </button>
                              <button
                                type="button"
                                className="btn btn--ghost"
                                title="Create a new relationship"
                                aria-label="Create a new relationship"
                                onClick={() => {
                                  setDraftCanvasRelationshipTypeId(canvasRelationshipTypeId || relationshipTypes[0]?.id || "");
                                  setNewRelationshipModalOpen(true);
                                  setConnectMenuOpen(false);
                                }}
                                style={{
                                  width: 40,
                                  minWidth: 40,
                                  height: 40,
                                  padding: 0,
                                  borderRadius: 12,
                                  border: "1px solid rgba(53, 80, 112, 0.12)",
                                  background: "rgba(53, 80, 112, 0.04)",
                                  color: "#355070",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: 18,
                                  fontWeight: 700,
                                }}
                              >
                                +
                              </button>
                              <button
                                type="button"
                                className="btn btn--ghost"
                                title="Create a new relationship type"
                                aria-label="Create a new relationship type"
                                onClick={() => {
                                  onOpenCreateRelationshipType();
                                  setConnectMenuOpen(false);
                                }}
                                style={{
                                  width: 40,
                                  minWidth: 40,
                                  height: 40,
                                  padding: 0,
                                  borderRadius: 12,
                                  border: "1px solid rgba(53, 80, 112, 0.12)",
                                  background: "rgba(53, 80, 112, 0.04)",
                                  color: "#355070",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: 16,
                                  fontWeight: 700,
                                }}
                              >
                                T
                              </button>
                            </div>
                          </div>
                        ) : null}
                        {isShapeTool && canvasTool === "shape" && shapeMenuOpen ? (
                          <div
                            role="menu"
                            data-canvas-shape-popover="menu"
                            style={{
                              position: "absolute",
                              left: 0,
                              bottom: "calc(100% + 10px)",
                              width: "max-content",
                              padding: 10,
                              borderRadius: 16,
                              border: "1px solid rgba(53, 80, 112, 0.14)",
                              background: "rgba(255, 255, 255, 0.98)",
                              boxShadow: "0 18px 40px rgba(15, 23, 42, 0.16)",
                              backdropFilter: "blur(10px)",
                              zIndex: 5,
                            }}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <div
                              style={{
                                display: "grid",
                                gridTemplateColumns: `repeat(${POSTGRES_OBJECT_TYPE_SHAPE_OPTIONS.length}, minmax(0, 1fr))`,
                                gap: 8,
                              }}
                            >
                              {POSTGRES_OBJECT_TYPE_SHAPE_OPTIONS.map((shapeOption) => (
                                <button
                                  key={shapeOption.value}
                                  type="button"
                                  className="btn btn--ghost"
                                  onClick={() => {
                                    setCanvasSketchShape(shapeOption.value);
                                    setCanvasTool("shape");
                                    setObjectMenuOpen(false);
                                    setShapeMenuOpen(false);
                                  }}
                                  title={shapeOption.label}
                                  aria-label={shapeOption.label}
                                  style={{
                                    width: 40,
                                    minWidth: 40,
                                    height: 40,
                                    padding: 0,
                                    borderRadius: 12,
                                    border: shapeOption.value === canvasSketchShape ? "1px solid rgba(53, 80, 112, 0.08)" : "1px solid rgba(53, 80, 112, 0.12)",
                                    background: shapeOption.value === canvasSketchShape ? "#355070" : "rgba(53, 80, 112, 0.04)",
                                    color: shapeOption.value === canvasSketchShape ? "#ffffff" : "#355070",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                  }}
                                >
                                  <ObjectShapeSwatch
                                    shape={shapeOption.value}
                                    fill="outline"
                                    color={shapeOption.value === canvasSketchShape ? "#ffffff" : "#355070"}
                                    width={22}
                                    minHeight={18}
                                  />
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                    })}
                  </div>
                    {showCanvasSketchStyleControls ? (
                      <div
                        style={{
                          marginTop: 12,
                          paddingTop: 12,
                          borderTop: "1px solid rgba(53, 80, 112, 0.10)",
                          display: "grid",
                          gap: 8,
                        }}
                      >
                        <div className="auth-hint" style={{ marginBottom: 0 }}>Draw style</div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                          <div
                            data-canvas-sketch-style-popover="anchor"
                            style={{ position: "relative" }}
                          >
                            <button
                              type="button"
                              className="btn btn--ghost"
                              title="Sketch color"
                              aria-label="Sketch color"
                              aria-haspopup="menu"
                              aria-expanded={canvasSketchColorMenuOpen}
                              onClick={() => {
                                setCanvasSketchColorMenuOpen((current) => !current);
                                setCanvasSketchLineStyleMenuOpen(false);
                                setCanvasSketchLineWeightMenuOpen(false);
                                setObjectMenuOpen(false);
                                setConnectMenuOpen(false);
                                setShapeMenuOpen(false);
                              }}
                              style={{
                                width: "100%",
                                minHeight: 44,
                                padding: 0,
                                borderRadius: 12,
                                border: canvasSketchColorMenuOpen ? "1px solid rgba(53, 80, 112, 0.08)" : "1px solid rgba(53, 80, 112, 0.12)",
                                background: canvasSketchColorMenuOpen ? "#355070" : "rgba(53, 80, 112, 0.04)",
                                color: canvasSketchColorMenuOpen ? "#ffffff" : "#355070",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                boxShadow: canvasSketchColorMenuOpen ? "0 12px 24px rgba(53, 80, 112, 0.20)" : "none",
                              }}
                            >
                              <span
                                aria-hidden="true"
                                style={{
                                  position: "relative",
                                  width: 22,
                                  height: 22,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" style={{ display: "block" }}>
                                  <path
                                    d="M10.7 2.8c2.6 2.7 5.5 5.8 5.5 8.6a6.2 6.2 0 1 1-12.4 0c0-2.4 2-4.8 4.6-7.7l1-1.1a.66.66 0 0 1 .96 0l.34.36Z"
                                    fill={canvasSketchColor}
                                    stroke="currentColor"
                                    strokeWidth="1.1"
                                    strokeLinejoin="round"
                                  />
                                  <path
                                    d="M7.4 12.35c.56.5 1.42.82 2.44.82 1.27 0 2.31-.49 2.86-1.18"
                                    stroke={canvasSketchColorMenuOpen ? "#ffffff" : "#ffffff"}
                                    strokeWidth="1"
                                    strokeLinecap="round"
                                    opacity="0.9"
                                  />
                                </svg>
                              </span>
                            </button>
                            {canvasSketchColorMenuOpen ? (
                              <div
                                role="menu"
                                data-canvas-sketch-style-popover="menu"
                                style={{
                                  position: "absolute",
                                  left: 0,
                                  bottom: "calc(100% + 10px)",
                                  width: "max-content",
                                  padding: 10,
                                  borderRadius: 16,
                                  border: "1px solid rgba(53, 80, 112, 0.14)",
                                  background: "rgba(255, 255, 255, 0.98)",
                                  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.16)",
                                  backdropFilter: "blur(10px)",
                                  zIndex: 5,
                                }}
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => event.stopPropagation()}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                  <input
                                    className="form-input form-input--color"
                                    type="color"
                                    value={canvasSketchColor}
                                    onChange={(event) => setCanvasSketchColor(event.target.value)}
                                    aria-label="Sketch color"
                                  />
                                  <input
                                    className="form-input"
                                    value={canvasSketchColor}
                                    onChange={(event) => setCanvasSketchColor(normalizePostgresExperimentObjectTypeColor(event.target.value))}
                                    aria-label="Sketch color hex value"
                                    style={{ width: 118, fontFamily: "monospace" }}
                                  />
                                </div>
                              </div>
                            ) : null}
                          </div>
                          <div
                            data-canvas-sketch-style-popover="anchor"
                            style={{ position: "relative" }}
                          >
                            <button
                              type="button"
                              className="btn btn--ghost"
                              title="Line style"
                              aria-label="Line style"
                              aria-haspopup="menu"
                              aria-expanded={canvasSketchLineStyleMenuOpen}
                              onClick={() => {
                                setCanvasSketchLineStyleMenuOpen((current) => !current);
                                setCanvasSketchColorMenuOpen(false);
                                setCanvasSketchLineWeightMenuOpen(false);
                                setObjectMenuOpen(false);
                                setConnectMenuOpen(false);
                                setShapeMenuOpen(false);
                              }}
                              style={{
                                width: "100%",
                                minHeight: 44,
                                padding: 0,
                                borderRadius: 12,
                                border: canvasSketchLineStyleMenuOpen ? "1px solid rgba(53, 80, 112, 0.08)" : "1px solid rgba(53, 80, 112, 0.12)",
                                background: canvasSketchLineStyleMenuOpen ? "#355070" : "rgba(53, 80, 112, 0.04)",
                                color: canvasSketchLineStyleMenuOpen ? "#ffffff" : "#355070",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                boxShadow: canvasSketchLineStyleMenuOpen ? "0 12px 24px rgba(53, 80, 112, 0.20)" : "none",
                              }}
                            >
                              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ display: "block" }}>
                                <line
                                  x1="2.5"
                                  y1="6"
                                  x2="17.5"
                                  y2="6"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  strokeLinecap="round"
                                />
                                <line
                                  x1="2.5"
                                  y1="10"
                                  x2="17.5"
                                  y2="10"
                                  stroke="currentColor"
                                  strokeWidth="2.4"
                                  strokeLinecap="round"
                                  strokeDasharray={getPostgresExperimentRelationshipStrokeDasharray(canvasSketchLineStyle)}
                                />
                                <line
                                  x1="2.5"
                                  y1="14"
                                  x2="17.5"
                                  y2="14"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  strokeLinecap="round"
                                />
                              </svg>
                            </button>
                            {canvasSketchLineStyleMenuOpen ? (
                              <div
                                role="menu"
                                data-canvas-sketch-style-popover="menu"
                                style={{
                                  position: "absolute",
                                  left: 0,
                                  bottom: "calc(100% + 10px)",
                                  width: "max-content",
                                  padding: 10,
                                  borderRadius: 16,
                                  border: "1px solid rgba(53, 80, 112, 0.14)",
                                  background: "rgba(255, 255, 255, 0.98)",
                                  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.16)",
                                  backdropFilter: "blur(10px)",
                                  zIndex: 5,
                                }}
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => event.stopPropagation()}
                              >
                                <div
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns: `repeat(${POSTGRES_RELATIONSHIP_LINE_SHAPE_OPTIONS.length}, minmax(0, 1fr))`,
                                    gap: 8,
                                  }}
                                >
                                  {POSTGRES_RELATIONSHIP_LINE_SHAPE_OPTIONS.map((option) => (
                                    <button
                                      key={option.value}
                                      type="button"
                                      className="btn btn--ghost"
                                      title={option.label}
                                      aria-label={option.label}
                                      onClick={() => {
                                        setCanvasSketchLineStyle(option.value);
                                        setCanvasSketchLineStyleMenuOpen(false);
                                      }}
                                      style={{
                                        width: 40,
                                        minWidth: 40,
                                        height: 40,
                                        padding: 0,
                                        borderRadius: 12,
                                        border: option.value === canvasSketchLineStyle ? "1px solid rgba(53, 80, 112, 0.08)" : "1px solid rgba(53, 80, 112, 0.12)",
                                        background: option.value === canvasSketchLineStyle ? "#355070" : "rgba(53, 80, 112, 0.04)",
                                        color: option.value === canvasSketchLineStyle ? "#ffffff" : "#355070",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                      }}
                                    >
                                      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true" style={{ display: "block" }}>
                                        <line
                                          x1="3"
                                          y1="11"
                                          x2="19"
                                          y2="11"
                                          stroke="currentColor"
                                          strokeWidth="2.4"
                                          strokeLinecap="round"
                                          strokeDasharray={getPostgresExperimentRelationshipStrokeDasharray(option.value)}
                                        />
                                      </svg>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                          <div
                            data-canvas-sketch-style-popover="anchor"
                            style={{ position: "relative" }}
                          >
                            <button
                              type="button"
                              className="btn btn--ghost"
                              title="Line thickness"
                              aria-label="Line thickness"
                              aria-haspopup="menu"
                              aria-expanded={canvasSketchLineWeightMenuOpen}
                              onClick={() => {
                                setCanvasSketchLineWeightMenuOpen((current) => !current);
                                setCanvasSketchColorMenuOpen(false);
                                setCanvasSketchLineStyleMenuOpen(false);
                                setObjectMenuOpen(false);
                                setConnectMenuOpen(false);
                                setShapeMenuOpen(false);
                              }}
                              style={{
                                width: "100%",
                                minHeight: 44,
                                padding: 0,
                                borderRadius: 12,
                                border: canvasSketchLineWeightMenuOpen ? "1px solid rgba(53, 80, 112, 0.08)" : "1px solid rgba(53, 80, 112, 0.12)",
                                background: canvasSketchLineWeightMenuOpen ? "#355070" : "rgba(53, 80, 112, 0.04)",
                                color: canvasSketchLineWeightMenuOpen ? "#ffffff" : "#355070",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                boxShadow: canvasSketchLineWeightMenuOpen ? "0 12px 24px rgba(53, 80, 112, 0.20)" : "none",
                              }}
                            >
                              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ display: "block" }}>
                                <line
                                  x1="4"
                                  y1="5"
                                  x2="16"
                                  y2="5"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                />
                                <line
                                  x1="4"
                                  y1="10"
                                  x2="16"
                                  y2="10"
                                  stroke="currentColor"
                                  strokeWidth="3"
                                  strokeLinecap="round"
                                />
                                <line
                                  x1="4"
                                  y1="15"
                                  x2="16"
                                  y2="15"
                                  stroke="currentColor"
                                  strokeWidth={getPostgresExperimentRelationshipStrokeWidth(canvasSketchLineWeight)}
                                  strokeLinecap="round"
                                />
                              </svg>
                            </button>
                            {canvasSketchLineWeightMenuOpen ? (
                              <div
                                role="menu"
                                data-canvas-sketch-style-popover="menu"
                                style={{
                                  position: "absolute",
                                  left: 0,
                                  bottom: "calc(100% + 10px)",
                                  width: "max-content",
                                  padding: 10,
                                  borderRadius: 16,
                                  border: "1px solid rgba(53, 80, 112, 0.14)",
                                  background: "rgba(255, 255, 255, 0.98)",
                                  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.16)",
                                  backdropFilter: "blur(10px)",
                                  zIndex: 5,
                                }}
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => event.stopPropagation()}
                              >
                                <div
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns: `repeat(${POSTGRES_RELATIONSHIP_LINE_WEIGHT_OPTIONS.length}, minmax(0, 1fr))`,
                                    gap: 8,
                                  }}
                                >
                                  {POSTGRES_RELATIONSHIP_LINE_WEIGHT_OPTIONS.map((option) => (
                                    <button
                                      key={option.value}
                                      type="button"
                                      className="btn btn--ghost"
                                      title={option.label}
                                      aria-label={option.label}
                                      onClick={() => {
                                        setCanvasSketchLineWeight(option.value);
                                        setCanvasSketchLineWeightMenuOpen(false);
                                      }}
                                      style={{
                                        width: 40,
                                        minWidth: 40,
                                        height: 40,
                                        padding: 0,
                                        borderRadius: 12,
                                        border: option.value === canvasSketchLineWeight ? "1px solid rgba(53, 80, 112, 0.08)" : "1px solid rgba(53, 80, 112, 0.12)",
                                        background: option.value === canvasSketchLineWeight ? "#355070" : "rgba(53, 80, 112, 0.04)",
                                        color: option.value === canvasSketchLineWeight ? "#ffffff" : "#355070",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                      }}
                                    >
                                      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true" style={{ display: "block" }}>
                                        <line
                                          x1="3"
                                          y1="11"
                                          x2="19"
                                          y2="11"
                                          stroke="currentColor"
                                          strokeWidth={getPostgresExperimentRelationshipStrokeWidth(option.value)}
                                          strokeLinecap="round"
                                        />
                                      </svg>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <div
                      style={{
                        marginTop: 12,
                        paddingTop: 12,
                        borderTop: "1px solid rgba(53, 80, 112, 0.10)",
                      }}
                    >
                      <div className="auth-hint" style={{ marginBottom: 8 }}>View controls</div>
                  {canvasTool === "connect" ? (
                    <div className="auth-hint" style={{ marginBottom: 8 }}>
                      {pendingConnectionSourceId
                        ? `Choose a target object for ${objectById.get(pendingConnectionSourceId)?.title ?? "the selected object"}.`
                        : selectedRelationshipType
                          ? `New relationship: ${selectedRelationshipType.name}. Click a source object, then a target object. Press Esc to cancel.`
                          : "Choose `New relationship` from the Connect menu to start drawing a relationship."}
                    </div>
                  ) : null}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => cyRef.current?.zoom(Math.min(2.4, (cyRef.current?.zoom() ?? canvasScale) * 1.12))}
                      style={{ justifyContent: "center" }}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => cyRef.current?.zoom(Math.max(0.4, (cyRef.current?.zoom() ?? canvasScale) / 1.12))}
                      style={{ justifyContent: "center" }}
                    >
                      -
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => cyRef.current?.fit(undefined, 36)}
                      aria-label="Center canvas"
                      title="Center canvas"
                      style={{ justifyContent: "center" }}
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 18 18"
                        fill="none"
                        aria-hidden="true"
                        style={{ display: "block" }}
                      >
                        <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.6" />
                        <path d="M9 1.75V4.25M9 13.75V16.25M1.75 9H4.25M13.75 9H16.25" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                    </div>
                  </div>
              )}
            </div>
          </div>
          <div
              className="nopan nodrag"
              style={{
                position: "absolute",
                marginTop: 16,
                marginRight: 16,
                top: 0,
                right: 0,
                width: inspectorCollapsed ? 56 : 320,
                transition: "width 160ms ease",
                pointerEvents: "auto",
              }}
            >
              <div
                  className="nopan nodrag"
                  style={{
                    overflow: "hidden",
                    borderRadius: 20,
                    border: "1px solid rgba(53, 80, 112, 0.12)",
                  background: "rgba(255, 255, 255, 0.96)",
                  boxShadow: "0 18px 36px rgba(53, 80, 112, 0.08)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: inspectorCollapsed ? 10 : 14,
                    borderBottom: inspectorCollapsed ? "none" : "1px solid rgba(53, 80, 112, 0.10)",
                  }}
                >
                  {inspectorCollapsed ? null : <h2 style={{ margin: 0, fontSize: 18 }}>Inspector</h2>}
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setInspectorCollapsed((current) => !current)}
                    aria-label={inspectorCollapsed ? "Open inspector" : "Collapse inspector"}
                    title={inspectorCollapsed ? "Open inspector" : "Collapse inspector"}
                    style={{
                      minWidth: 36,
                      width: 36,
                      height: 36,
                      padding: 0,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {inspectorCollapsed ? "<" : ">"}
                  </button>
                </div>

                {inspectorCollapsed ? null : (
                  <div
                    style={{
                      maxHeight: "calc(100vh - 280px)",
                      overflow: "auto",
                      padding: 18,
                      pointerEvents: "auto",
                    }}
                    onWheel={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {selectedObject ? (
                      (() => {
                        const objectTypeRecord = objectTypeById.get(selectedObject.objectTypeId) ?? null;
                        const appearance = getPostgresExperimentObjectAppearance(selectedObject, objectTypeRecord);
                        return (
                          <>
                        <div className="auth-hint" style={{ marginBottom: 14 }}>Selected object</div>
                        <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#52606d" }}>
                          {selectedObject.objectType}
                        </div>
                        <div style={{ marginTop: 8, fontSize: 20, fontWeight: 700, color: "#1f2933" }}>
                          {selectedObject.title}
                        </div>
                        <p style={{ marginTop: 12, color: "#52606d", lineHeight: 1.5 }}>
                          {selectedObject.description || "No description yet."}
                        </p>
                        <div className="home-restricted-list" style={{ marginTop: 16 }}>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">Appearance</span>
                            <span className="home-restricted-value" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <ObjectShapeSwatch
                                shape={appearance.shape}
                                fill={appearance.fill}
                                color={appearance.color}
                                sourceVisualKey={appearance.sourceVisualKey}
                                width={22}
                                minHeight={16}
                              />
                              <span>{`${formatPostgresExperimentObjectShapeLabel(appearance.shape)} / ${formatPostgresExperimentObjectFillLabel(appearance.fill)}`}</span>
                            </span>
                          </div>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">Overrides</span>
                            <span className="home-restricted-value">
                              {appearance.hasShapeOverride || appearance.hasColorOverride || appearance.hasFillOverride
                                ? [appearance.hasShapeOverride ? "Shape" : "", appearance.hasColorOverride ? "Color" : "", appearance.hasFillOverride ? "Fill" : ""].filter(Boolean).join(" + ")
                                : "Inherited"}
                            </span>
                          </div>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">Attributes</span>
                            <span className="home-restricted-value">{selectedObjectAttributeDefinitions.length}</span>
                          </div>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">Connected links</span>
                            <span className="home-restricted-value">
                              {relationships.filter((relationship) => relationship.fromObjectId === selectedObject.id || relationship.toObjectId === selectedObject.id).length}
                            </span>
                          </div>
                        </div>
                        {selectedObjectAttributeDefinitions.length > 0 ? (
                          <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
                            <span className="auth-hint" style={{ margin: 0 }}>Attributes</span>
                            <div className="case-detail-attributes-table-wrap">
                              <table className="case-detail-attributes-table">
                                <tbody>
                                  {selectedObjectAttributeDefinitions.map((definition) => {
                                    const attributeValue = selectedObject.attributeValues.find(
                                      (value) => value.attributeDefinitionId === definition.id,
                                    )?.value;
                                    return (
                                      <tr key={definition.id}>
                                        <th className="case-detail-attributes-label" scope="row">{definition.name}</th>
                                        <td className="case-detail-attributes-value">{attributeValue?.trim() ? attributeValue : "-"}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : null}
                        {!isReadOnly ? (
                          <div
                            className="form-actions"
                            style={{ marginTop: 18, justifyContent: "flex-start" }}
                            onPointerDown={(event) => event.stopPropagation()}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="btn"
                              onClick={() => onEditObject(selectedObject)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost"
                              style={{ color: "#b42318" }}
                              onClick={() => {
                                onDeleteObject(selectedObject.id);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        ) : null}
                          </>
                        );
                      })()
                    ) : selectedRelationship ? (
                      <>
                        {(() => {
                          const relationshipTypeRecord = relationshipTypes.find(
                            (relationshipType) => relationshipType.id === selectedRelationship.relationshipTypeId,
                          ) ?? null;
                          const appearance = getPostgresExperimentRelationshipAppearance(selectedRelationship, relationshipTypeRecord);
                          return (
                            <>
                        <div className="auth-hint" style={{ marginBottom: 14 }}>Selected relationship</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: "#1f2933" }}>
                          {selectedRelationship.relationshipType}
                        </div>
                        <div className="home-restricted-list" style={{ marginTop: 16 }}>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">Appearance</span>
                            <span className="home-restricted-value" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <svg width="40" height="14" viewBox="0 0 40 14" aria-hidden="true">
                                <defs>
                                  <marker id="canvas-selected-relationship-end" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                                    <path d="M0,0 L7,3.5 L0,7 z" fill={appearance.color} />
                                  </marker>
                                  <marker id="canvas-selected-relationship-start" markerWidth="7" markerHeight="7" refX="1" refY="3.5" orient="auto">
                                    <path d="M7,0 L0,3.5 L7,7 z" fill={appearance.color} />
                                  </marker>
                                </defs>
                                <line
                                  x1="2"
                                  y1="7"
                                  x2="38"
                                  y2="7"
                                  stroke={appearance.color}
                                  strokeWidth={getPostgresExperimentRelationshipStrokeWidth(appearance.lineWeight)}
                                  strokeDasharray={getPostgresExperimentRelationshipStrokeDasharray(appearance.lineShape)}
                                  markerEnd={appearance.arrowhead === "none" ? undefined : "url(#canvas-selected-relationship-end)"}
                                  markerStart={appearance.arrowhead === "double_sided" ? "url(#canvas-selected-relationship-start)" : undefined}
                                />
                              </svg>
                              <span>{`${formatPostgresExperimentRelationshipLineShapeLabel(appearance.lineShape)} | ${formatPostgresExperimentRelationshipLineWeightLabel(appearance.lineWeight)} | ${formatPostgresExperimentRelationshipArrowheadLabel(appearance.arrowhead)}`}</span>
                            </span>
                          </div>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">Overrides</span>
                            <span className="home-restricted-value">
                              {appearance.hasLineShapeOverride || appearance.hasLineWeightOverride || appearance.hasArrowheadOverride || appearance.hasColorOverride
                                ? [appearance.hasLineShapeOverride ? "Line shape" : "", appearance.hasLineWeightOverride ? "Line weight" : "", appearance.hasArrowheadOverride ? "Arrowheads" : "", appearance.hasColorOverride ? "Color" : ""].filter(Boolean).join(" + ")
                                : "Inherited"}
                            </span>
                          </div>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">From</span>
                            <span className="home-restricted-value">{objectById.get(selectedRelationship.fromObjectId)?.title ?? "Unknown object"}</span>
                          </div>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">To</span>
                            <span className="home-restricted-value">{objectById.get(selectedRelationship.toObjectId)?.title ?? "Unknown object"}</span>
                          </div>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">Attributes</span>
                            <span className="home-restricted-value">{selectedRelationshipAttributeDefinitions.length}</span>
                          </div>
                        </div>
                        {selectedRelationshipAttributeDefinitions.length > 0 ? (
                          <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
                            <span className="auth-hint" style={{ margin: 0 }}>Attributes</span>
                            <div className="case-detail-attributes-table-wrap">
                              <table className="case-detail-attributes-table">
                                <tbody>
                                  {selectedRelationshipAttributeDefinitions.map((definition) => {
                                    const attributeValue = selectedRelationship.attributeValues.find(
                                      (value) => value.attributeDefinitionId === definition.id,
                                    )?.value;
                                    return (
                                      <tr key={definition.id}>
                                        <th className="case-detail-attributes-label" scope="row">{definition.name}</th>
                                        <td className="case-detail-attributes-value">{attributeValue?.trim() ? attributeValue : "-"}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : null}
                        <p style={{ marginTop: 14, color: "#52606d", lineHeight: 1.5 }}>
                          {selectedRelationship.description || "No description yet."}
                        </p>
                        {!isReadOnly ? (
                          <div
                            className="form-actions"
                            style={{ marginTop: 18, justifyContent: "flex-start" }}
                            onPointerDown={(event) => event.stopPropagation()}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="btn"
                              onClick={() => onEditRelationship(selectedRelationship)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost"
                              style={{ color: "#b42318" }}
                              onClick={() => {
                                onDeleteRelationship(selectedRelationship.id);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        ) : null}
                            </>
                          );
                        })()}
                      </>
                    ) : selectedShape ? (
                      <>
                        <div className="auth-hint" style={{ marginBottom: 14 }}>Selected sketch</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: "#1f2933" }}>
                          {selectedShape.kind === "pen" ? "Freehand line" : selectedShape.kind === "text" ? "Text" : formatCanvasSketchShapeLabel(getCanvasSketchShapeType(selectedShape))}
                        </div>
                        {!isReadOnly ? (
                          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                            {selectedShape.kind === "shape" ? (
                              <label style={{ display: "grid", gap: 6 }}>
                                <span className="auth-hint" style={{ margin: 0 }}>Shape</span>
                                <select
                                  className="input"
                                  value={selectedShape.shape}
                                  onChange={(event) => {
                                    const nextShape = normalizePostgresExperimentObjectTypeShape(event.target.value);
                                    setCanvasShapes((current) => current.map((shape) => (
                                      shape.id === selectedShape.id && shape.kind === "shape" ? { ...shape, shape: nextShape } : shape
                                    )));
                                  }}
                                >
                                  {POSTGRES_OBJECT_TYPE_SHAPE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </label>
                            ) : null}
                            {selectedShape.kind === "shape" || selectedShape.kind === "rectangle" ? (
                              <label style={{ display: "grid", gap: 6 }}>
                                <span className="auth-hint" style={{ margin: 0 }}>Fill</span>
                                <select
                                  className="input"
                                  value={getCanvasSketchShapeFill(selectedShape)}
                                  onChange={(event) => {
                                    const nextFill = normalizePostgresExperimentObjectFill(event.target.value);
                                    setCanvasShapes((current) => current.map((shape) => (
                                      shape.id === selectedShape.id && (shape.kind === "shape" || shape.kind === "rectangle")
                                        ? { ...shape, fill: nextFill }
                                        : shape
                                    )));
                                  }}
                                >
                                  {POSTGRES_OBJECT_FILL_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                              </label>
                            ) : null}
                            <label style={{ display: "grid", gap: 6 }}>
                              <span className="auth-hint" style={{ margin: 0 }}>Color</span>
                              <input
                                className="input"
                                type="color"
                                value={selectedShape.color}
                                onChange={(event) => {
                                  const nextColor = event.target.value;
                                  setCanvasShapes((current) => current.map((shape) => (
                                    shape.id === selectedShape.id ? { ...shape, color: nextColor } : shape
                                  )));
                                }}
                              />
                            </label>
                            {selectedShape.kind !== "text" ? (
                              <label style={{ display: "grid", gap: 6 }}>
                                <span className="auth-hint" style={{ margin: 0 }}>Line style</span>
                                <PostgresExperimentRelationshipLineShapePicker
                                  value={getCanvasSketchLineStyle(selectedShape)}
                                  onChange={(value) => {
                                    const nextLineStyle = normalizePostgresExperimentRelationshipLineShape(value || "");
                                    setCanvasShapes((current) => current.map((shape) => (
                                      shape.id === selectedShape.id && shape.kind !== "text"
                                        ? { ...shape, lineStyle: nextLineStyle }
                                        : shape
                                    )));
                                  }}
                                  previewColor={selectedShape.color}
                                />
                              </label>
                            ) : null}
                            <label style={{ display: "grid", gap: 6 }}>
                              <span className="auth-hint" style={{ margin: 0 }}>Stroke width</span>
                              <input
                                className="input"
                                type="number"
                                min={1}
                                max={12}
                                step={1}
                                value={selectedShape.strokeWidth}
                                onChange={(event) => {
                                  const nextStrokeWidth = Math.max(1, Number(event.target.value) || 1);
                                  setCanvasShapes((current) => current.map((shape) => (
                                    shape.id === selectedShape.id ? { ...shape, strokeWidth: nextStrokeWidth } : shape
                                  )));
                                }}
                              />
                            </label>
                            {selectedShape.kind === "text" ? (
                              <>
                                <label style={{ display: "grid", gap: 6 }}>
                                  <span className="auth-hint" style={{ margin: 0 }}>Font size</span>
                                  <input
                                    className="input"
                                    type="number"
                                    min={10}
                                    max={72}
                                    step={1}
                                    value={selectedShape.fontSize}
                                    onChange={(event) => {
                                      const nextFontSize = Math.max(10, Number(event.target.value) || 18);
                                      updateCanvasTextShape(selectedShape.id, (shape) => ({ ...shape, fontSize: nextFontSize }));
                                    }}
                                  />
                                </label>
                                <label style={{ display: "grid", gap: 6 }}>
                                  <span className="auth-hint" style={{ margin: 0 }}>Text align</span>
                                  <select
                                    className="input"
                                    value={selectedShape.textAlign}
                                    onChange={(event) => {
                                      const nextTextAlign = event.target.value as "left" | "center" | "right";
                                      updateCanvasTextShape(selectedShape.id, (shape) => ({ ...shape, textAlign: nextTextAlign }));
                                    }}
                                  >
                                    <option value="left">Left</option>
                                    <option value="center">Center</option>
                                    <option value="right">Right</option>
                                  </select>
                                </label>
                              </>
                            ) : null}
                          </div>
                        ) : null}
                        <div className="home-restricted-list" style={{ marginTop: 16 }}>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">Canvas item</span>
                            <span className="home-restricted-value">{selectedShape.id.slice(0, 8)}</span>
                          </div>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">Color</span>
                            <span className="home-restricted-value">{selectedShape.color}</span>
                          </div>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">Stroke</span>
                            <span className="home-restricted-value">{selectedShape.strokeWidth}</span>
                          </div>
                          {selectedShape.kind === "text" ? (
                            <div className="home-restricted-item">
                              <span className="home-restricted-label">Font size</span>
                              <span className="home-restricted-value">{selectedShape.fontSize}</span>
                            </div>
                          ) : null}
                        </div>
                        {!isReadOnly ? (
                          <div className="form-actions" style={{ marginTop: 18 }}>
                            <button type="button" className="btn btn--danger" onClick={() => deleteCanvasShape(selectedShape.id)}>
                              Delete sketch
                            </button>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <div className="auth-hint" style={{ marginBottom: 14 }}>
                          Select an object or relationship to inspect it here.
                        </div>
                        <div className="home-restricted-list">
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">Objects</span>
                            <span className="home-restricted-value">{objects.length}</span>
                          </div>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">Relationships</span>
                            <span className="home-restricted-value">{relationships.length}</span>
                          </div>
                          <div className="home-restricted-item">
                            <span className="home-restricted-label">Sketches</span>
                            <span className="home-restricted-value">{canvasShapes.length}</span>
                          </div>
                        </div>
                        {!isReadOnly ? (
                          <div className="form-actions" style={{ marginTop: 18 }}>
                            <button type="button" className="btn btn--primary" onClick={() => onCreateObjectAt(undefined, getCanvasCenterWorld())}>
                              Create object here
                            </button>
                          </div>
                        ) : null}
                      </>
                    )}

                  </div>
                )}
              </div>
          </div>

          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
            }}
          >
            <svg width="100%" height="100%" style={{ display: "block", overflow: "visible" }}>
              <g transform={`translate(${canvasOffset.x} ${canvasOffset.y}) scale(${canvasScale})`}>
                {canvasTool === "connect" && connectPreviewSourceNode && connectPreviewWorld && connectPreviewSourceObject ? (
                  (() => {
                    const sourceObjectType = objectTypeById.get(connectPreviewSourceObject.objectTypeId) ?? null;
                    const sourceShape = getPostgresExperimentObjectAppearance(connectPreviewSourceObject, sourceObjectType).shape;
                    const sourceCenter = {
                      x: connectPreviewSourceNode.x + connectPreviewSourceNode.width / 2,
                      y: connectPreviewSourceNode.y + connectPreviewSourceNode.height / 2,
                    };
                    if (connectPreviewTargetNode && connectPreviewTargetObject) {
                      const targetObjectType = objectTypeById.get(connectPreviewTargetObject.objectTypeId) ?? null;
                      const targetShape = getPostgresExperimentObjectAppearance(connectPreviewTargetObject, targetObjectType).shape;
                      const targetCenter = {
                        x: connectPreviewTargetNode.x + connectPreviewTargetNode.width / 2,
                        y: connectPreviewTargetNode.y + connectPreviewTargetNode.height / 2,
                      };
                      const start = getCanvasNodeBoundaryPoint(
                        sourceShape,
                        connectPreviewSourceNode,
                        targetCenter,
                      );
                      const end = getCanvasNodeBoundaryPoint(
                        targetShape,
                        connectPreviewTargetNode,
                        sourceCenter,
                      );
                      return (
                        <>
                          <defs>
                            <marker id="canvas-connect-preview-end" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                              <path d="M0,0 L7,3.5 L0,7 z" fill="#355070" />
                            </marker>
                          </defs>
                          <line
                            x1={start.x}
                            y1={start.y}
                            x2={end.x}
                            y2={end.y}
                            stroke="#355070"
                            strokeWidth={2.5}
                            strokeDasharray="8 6"
                            markerEnd="url(#canvas-connect-preview-end)"
                            pointerEvents="none"
                          />
                        </>
                      );
                    }
                    const start = getCanvasNodeBoundaryPoint(
                      sourceShape,
                      connectPreviewSourceNode,
                      connectPreviewWorld,
                    );
                    return (
                      <>
                        <defs>
                          <marker id="canvas-connect-preview-end" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                            <path d="M0,0 L7,3.5 L0,7 z" fill="#355070" />
                          </marker>
                        </defs>
                        <line
                          x1={start.x}
                          y1={start.y}
                          x2={connectPreviewWorld.x}
                          y2={connectPreviewWorld.y}
                          stroke="#355070"
                          strokeWidth={2.5}
                          strokeDasharray="8 6"
                          markerEnd="url(#canvas-connect-preview-end)"
                          pointerEvents="none"
                        />
                      </>
                    );
                  })()
                ) : null}
                {canvasShapes.map((shape) => {
                  if (shape.kind === "pen") {
                    const bounds = getCanvasShapeBounds(shape);
                    const strokeDasharray = getPostgresExperimentRelationshipStrokeDasharray(getCanvasSketchLineStyle(shape));
                    return (
                      <g key={shape.id}>
                        <polyline
                          points={shape.points.map((point) => `${point.x},${point.y}`).join(" ")}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={Math.max(shape.strokeWidth + 10, 14)}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          pointerEvents="stroke"
                          style={{ cursor: canvasTool === "select" ? "grab" : "pointer" }}
                          onPointerDown={(event) => beginCanvasShapeMove(event, shape)}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (canvasTool === "eraser") {
                              deleteCanvasShape(shape.id);
                              return;
                            }
                            setSelectedShapeId(shape.id);
                            setSelectedNodeId(null);
                            setSelectedEdgeId(null);
                            setCanvasNotice("");
                          }}
                        />
                        <polyline
                          points={shape.points.map((point) => `${point.x},${point.y}`).join(" ")}
                          fill="none"
                          stroke={shape.id === selectedShapeId ? "#d62828" : shape.color}
                          strokeWidth={shape.id === selectedShapeId ? shape.strokeWidth + 1.5 : shape.strokeWidth}
                          strokeDasharray={strokeDasharray}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          pointerEvents="none"
                        />
                        {shape.id === selectedShapeId && canvasTool === "select" ? (
                          <rect
                            x={bounds.x - 8}
                            y={bounds.y - 8}
                            width={bounds.width + 16}
                            height={bounds.height + 16}
                            fill="none"
                            stroke="rgba(214, 40, 40, 0.42)"
                            strokeWidth={1.5}
                            strokeDasharray="6 4"
                            pointerEvents="none"
                          />
                        ) : null}
                      </g>
                    );
                  }
                  const bounds = getCanvasShapeBounds(shape);
                  return (
                    <g
                      key={shape.id}
                    >
                      {shape.kind === "text" ? null : (
                        <g
                          onPointerDown={(event) => beginCanvasShapeMove(event, shape)}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (canvasTool === "eraser") {
                              deleteCanvasShape(shape.id);
                              return;
                            }
                            setSelectedShapeId(shape.id);
                            setSelectedNodeId(null);
                            setSelectedEdgeId(null);
                            setCanvasNotice("");
                          }}
                        >
                          {renderCanvasSketchShapeElement(shape, shape.id === selectedShapeId)}
                        </g>
                      )}
                      {shape.id === selectedShapeId && canvasTool === "select" ? (
                        <>
                          <rect
                            x={bounds.x - 6}
                            y={bounds.y - 6}
                            width={bounds.width + 12}
                            height={bounds.height + 12}
                            fill="none"
                            stroke="rgba(214, 40, 40, 0.42)"
                            strokeWidth={1.5}
                            strokeDasharray="6 4"
                            pointerEvents="none"
                          />
                          {([
                            { key: "nw", x: bounds.x, y: bounds.y, cursor: "nwse-resize" },
                            { key: "ne", x: bounds.x + bounds.width, y: bounds.y, cursor: "nesw-resize" },
                            { key: "sw", x: bounds.x, y: bounds.y + bounds.height, cursor: "nesw-resize" },
                            { key: "se", x: bounds.x + bounds.width, y: bounds.y + bounds.height, cursor: "nwse-resize" },
                          ] as { key: "nw" | "ne" | "sw" | "se"; x: number; y: number; cursor: string }[]).map((handle) => (
                            <circle
                              key={handle.key}
                              cx={handle.x}
                              cy={handle.y}
                              r={6}
                              fill="#ffffff"
                              stroke="#d62828"
                              strokeWidth={2}
                              pointerEvents="all"
                              style={{ cursor: handle.cursor }}
                              onPointerDown={(event) => beginCanvasShapeResize(event, shape as Extract<PostgresExperimentCanvasShape, { kind: "rectangle" | "shape" | "text" }>, handle.key)}
                            />
                          ))}
                        </>
                      ) : null}
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>
        </div>
        {existingObjectsModalOpen ? (
          <div className="modal-overlay" onClick={() => setExistingObjectsModalOpen(false)}>
            <div className="modal" onClick={(event) => event.stopPropagation()} style={{ width: "min(560px, calc(100vw - 32px))" }}>
              <h2>Add Existing Object</h2>
              <div className="auth-hint" style={{ marginTop: -6, marginBottom: 14 }}>
                Choose an existing project object to place on the canvas.
              </div>
              {objects.length === 0 ? (
                <div style={{ color: "#52606d", lineHeight: 1.5 }}>
                  No objects exist yet. Use the new object option to create one first.
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gap: 8,
                    maxHeight: "min(56vh, 420px)",
                    overflowY: "auto",
                    paddingRight: 4,
                  }}
                >
                  {objects
                    .slice()
                    .sort((left, right) => left.title.localeCompare(right.title))
                    .map((object) => {
                      const objectType = objectTypeById.get(object.objectTypeId) ?? null;
                      const appearance = getPostgresExperimentObjectAppearance(object, objectType);
                      const isOnCanvas = !!canvasNodes[object.id];
                      return (
                        <button
                          key={object.id}
                          type="button"
                          className="btn btn--ghost"
                          onClick={() => {
                            addExistingObjectToCanvas(object, getCanvasCenterWorld());
                            setExistingObjectsModalOpen(false);
                          }}
                          style={{
                            width: "100%",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 12,
                            padding: "12px 14px",
                            borderRadius: 14,
                            border: `1px solid ${hexToRgba(appearance.color, 0.24)}`,
                            background: "rgba(255, 255, 255, 0.94)",
                          }}
                        >
                          <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                            <ObjectShapeSwatch
                              shape={appearance.shape}
                              fill={appearance.fill}
                              color={appearance.color}
                              sourceVisualKey={appearance.sourceVisualKey}
                              width={22}
                              minHeight={18}
                            />
                            <span style={{ display: "grid", gap: 2, textAlign: "left", minWidth: 0 }}>
                              <span style={{ fontWeight: 700, color: "#1f2933", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {object.title}
                              </span>
                              <span style={{ fontSize: 12, color: "#52606d", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {objectType?.name || "Untyped object"}
                              </span>
                            </span>
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: isOnCanvas ? "#355070" : "#52606d", whiteSpace: "nowrap" }}>
                            {isOnCanvas ? "On canvas" : "Add"}
                          </span>
                        </button>
                      );
                    })}
                </div>
              )}
              <div className="form-actions" style={{ marginTop: 18 }}>
                <button type="button" className="btn" onClick={() => setExistingObjectsModalOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {existingRelationshipsModalOpen ? (
          <div className="modal-overlay" onClick={() => setExistingRelationshipsModalOpen(false)}>
            <div className="modal" onClick={(event) => event.stopPropagation()} style={{ width: "min(620px, calc(100vw - 32px))" }}>
              <h2>Add Existing Relationship</h2>
              <div className="auth-hint" style={{ marginTop: -6, marginBottom: 14 }}>
                Choose an existing project relationship to place on the canvas.
              </div>
              {relationships.length === 0 ? (
                <div style={{ color: "#52606d", lineHeight: 1.5 }}>
                  No relationships exist yet. Use the new relationship option to create one first.
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gap: 8,
                    maxHeight: "min(56vh, 420px)",
                    overflowY: "auto",
                    paddingRight: 4,
                  }}
                >
                  {relationships
                    .slice()
                    .sort((left, right) => left.relationshipType.localeCompare(right.relationshipType))
                    .map((relationship) => {
                      const isOnCanvas = !hiddenCanvasRelationshipIds.includes(relationship.id)
                        && !!canvasNodes[relationship.fromObjectId]
                        && !!canvasNodes[relationship.toObjectId];
                      return (
                        <button
                          key={relationship.id}
                          type="button"
                          className="btn btn--ghost"
                          onClick={() => {
                            addExistingRelationshipToCanvas(relationship, getCanvasCenterWorld());
                            setExistingRelationshipsModalOpen(false);
                          }}
                          style={{
                            width: "100%",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 12,
                            padding: "12px 14px",
                            borderRadius: 14,
                            border: "1px solid rgba(53, 80, 112, 0.14)",
                            background: "rgba(255, 255, 255, 0.94)",
                          }}
                        >
                          <span style={{ display: "grid", gap: 2, textAlign: "left", minWidth: 0 }}>
                            <span style={{ fontWeight: 700, color: "#1f2933" }}>
                              {relationship.relationshipType}
                            </span>
                            <span style={{ fontSize: 12, color: "#52606d", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {(objectById.get(relationship.fromObjectId)?.title ?? "Unknown")} to {(objectById.get(relationship.toObjectId)?.title ?? "Unknown")}
                            </span>
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: isOnCanvas ? "#355070" : "#52606d", whiteSpace: "nowrap" }}>
                            {isOnCanvas ? "On canvas" : "Add"}
                          </span>
                        </button>
                      );
                    })}
                </div>
              )}
              <div className="form-actions" style={{ marginTop: 18 }}>
                <button type="button" className="btn" onClick={() => setExistingRelationshipsModalOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {newRelationshipModalOpen ? (
          <div className="modal-overlay" onClick={() => setNewRelationshipModalOpen(false)}>
            <div className="modal" onClick={(event) => event.stopPropagation()} style={{ width: "min(520px, calc(100vw - 32px))" }}>
              <h2>Start New Relationship</h2>
              <div className="auth-hint" style={{ marginTop: -6, marginBottom: 14 }}>
                Choose a relationship type, then click a source object and a target object on the canvas.
              </div>
              <label className="form-label">
                Relationship type
                <select
                  className="form-input"
                  value={draftCanvasRelationshipTypeId}
                  onChange={(event) => setDraftCanvasRelationshipTypeId(event.target.value)}
                  autoFocus
                >
                  <option value="">Choose relationship type</option>
                  {relationshipTypes.map((relationshipType) => (
                    <option key={relationshipType.id} value={relationshipType.id}>
                      {relationshipType.name}
                    </option>
                  ))}
                </select>
              </label>
              {draftCanvasRelationshipTypeId
                && relationshipTypes.find((relationshipType) => relationshipType.id === draftCanvasRelationshipTypeId) ? (
                  <div className="auth-hint" style={{ marginTop: 10 }}>
                    {formatRelationshipTypeConstraintSummary(
                      relationshipTypes.find((relationshipType) => relationshipType.id === draftCanvasRelationshipTypeId)!,
                    )}
                  </div>
                ) : null}
              <div className="form-actions" style={{ marginTop: 18 }}>
                <button type="button" className="btn" onClick={() => setNewRelationshipModalOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={!draftCanvasRelationshipTypeId}
                  onClick={() => {
                    if (!draftCanvasRelationshipTypeId) return;
                    setCanvasRelationshipTypeId(draftCanvasRelationshipTypeId);
                    setCanvasTool("connect");
                    setPendingConnectionSourceId(null);
                    setCanvasNotice("Relationship mode is ready. Choose a source object.");
                    setCanvasError("");
                    setNewRelationshipModalOpen(false);
                  }}
                >
                  Start connecting
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PostgresExperimentExploreCanvasView({
  objectTypes,
  objects,
  relationships,
  relationshipTypes,
  canvasNodes,
  setCanvasNodes,
  hiddenCanvasRelationshipIds,
}: {
  objectTypes: PostgresExperimentObjectType[];
  objects: PostgresExperimentObject[];
  relationships: PostgresExperimentRelationship[];
  relationshipTypes: PostgresExperimentRelationshipType[];
  canvasNodes: Record<string, PostgresExperimentCanvasNodeState>;
  setCanvasNodes: Dispatch<SetStateAction<Record<string, PostgresExperimentCanvasNodeState>>>;
  hiddenCanvasRelationshipIds: string[];
}) {
  const cyContainerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<CytoscapeCore | null>(null);
  const objectTypeById = useMemo(
    () => new Map(objectTypes.map((objectType) => [objectType.id, objectType])),
    [objectTypes],
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [layoutRunning, setLayoutRunning] = useState(false);
  const [layoutError, setLayoutError] = useState("");
  const objectById = useMemo(() => new Map(objects.map((object) => [object.id, object])), [objects]);
  const latestExploreStateRef = useRef({ canvasNodes });
  const relationshipById = useMemo(
    () => new Map(relationships.map((relationship) => [relationship.id, relationship])),
    [relationships],
  );
  const graphElements = useMemo(
    () => buildPostgresExperimentCanvasCytoscapeElements(
      objects,
      canvasNodes,
      objectTypeById,
      relationships,
      relationshipTypes,
      hiddenCanvasRelationshipIds,
    ),
    [canvasNodes, hiddenCanvasRelationshipIds, objectTypeById, objects, relationshipTypes, relationships],
  );
  const selectedObject = selectedNodeId ? objectById.get(selectedNodeId) ?? null : null;
  const selectedRelationship = selectedEdgeId ? relationshipById.get(selectedEdgeId) ?? null : null;

  useEffect(() => {
    latestExploreStateRef.current = { canvasNodes };
  }, [canvasNodes]);

  function buildUpdatedNodes(
    current: Record<string, PostgresExperimentCanvasNodeState>,
    node: { id: string; position: { x: number; y: number } },
  ) {
    const object = objectById.get(node.id) ?? null;
    const objectTypeRecord = object ? objectTypeById.get(object.objectTypeId) ?? null : null;
    const shape = object ? getPostgresExperimentObjectAppearance(object, objectTypeRecord).shape : "rectangle";
    const defaultDimensions = getCanvasNodeDefaultDimensions(shape);
    return {
      ...current,
      [node.id]: {
        id: node.id,
        x: node.position.x,
        y: node.position.y,
        width: current[node.id]?.width ?? defaultDimensions.width,
        height: current[node.id]?.height ?? defaultDimensions.height,
      },
    };
  }

  async function handleAutoLayout() {
    setLayoutRunning(true);
    setLayoutError("");
    try {
      const nextCanvasNodes = await computePostgresExperimentCanvasAutoLayout({
        mode: "layered",
        objects,
        objectTypes,
        relationships,
        canvasNodes,
        hiddenRelationshipIds: hiddenCanvasRelationshipIds,
      });
      setCanvasNodes(nextCanvasNodes);
      window.setTimeout(() => {
        cyRef.current?.fit(undefined, 36);
      }, 0);
    } catch (error) {
      setLayoutError(error instanceof Error ? error.message : String(error));
    } finally {
      setLayoutRunning(false);
    }
  }

  useEffect(() => {
    if (!cyContainerRef.current || cyRef.current) return;

    const cy = cytoscape({
      container: cyContainerRef.current,
      elements: graphElements,
      style: POSTGRES_EXPERIMENT_CYTOSCAPE_STYLESHEET,
      layout: { name: "preset" },
      minZoom: 0.3,
      maxZoom: 2.4,
      wheelSensitivity: 0.18,
      selectionType: "single",
      boxSelectionEnabled: false,
    });

    cyRef.current = cy;
    if (graphElements.length > 0) {
      window.setTimeout(() => cy.fit(undefined, 36), 0);
    }

    const handleNodeTap = (event: { target: { id: () => string } }) => {
      setSelectedNodeId(event.target.id());
      setSelectedEdgeId(null);
    };
    const handleEdgeTap = (event: { target: { id: () => string } }) => {
      setSelectedEdgeId(event.target.id());
      setSelectedNodeId(null);
    };
    const handleBackgroundTap = (event: { target: unknown }) => {
      if (event.target !== cy) return;
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
    };
    const handleNodeDragFree = (event: { target: { id: () => string; position: () => { x: number; y: number } } }) => {
      const nodeId = event.target.id();
      const position = event.target.position();
      const nodeState = latestExploreStateRef.current.canvasNodes[nodeId];
      if (!nodeState) return;
      setCanvasNodes((current) => buildUpdatedNodes(current, {
        id: nodeId,
        position: {
          x: position.x - nodeState.width / 2,
          y: position.y - nodeState.height / 2,
        },
      }));
    };

    cy.on("tap", "node", handleNodeTap);
    cy.on("tap", "edge", handleEdgeTap);
    cy.on("tap", handleBackgroundTap);
    cy.on("dragfree", "node", handleNodeDragFree);

    return () => {
      cy.removeListener("tap", "node", handleNodeTap);
      cy.removeListener("tap", "edge", handleEdgeTap);
      cy.removeListener("tap", handleBackgroundTap);
      cy.removeListener("dragfree", "node", handleNodeDragFree);
      cy.destroy();
      cyRef.current = null;
    };
  }, [canvasNodes, graphElements, setCanvasNodes]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().remove();
      cy.add(graphElements);
    });
  }, [graphElements]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().unselect();
      if (selectedNodeId) cy.$id(selectedNodeId).select();
      if (selectedEdgeId) cy.$id(selectedEdgeId).select();
    });
  }, [selectedEdgeId, selectedNodeId]);

  return (
    <div className="view users-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>Explore</h1>
          <p className="auth-hint" style={{ margin: "6px 0 0" }}>
            Browse project objects as a navigable relationship graph and re-run auto layout when the structure changes.
          </p>
        </div>
        <div className="view-header-actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void handleAutoLayout()}
            disabled={layoutRunning || Object.keys(canvasNodes).length === 0}
          >
            {layoutRunning ? "Laying out..." : "Auto layout"}
          </button>
        </div>
      </header>

      {layoutError ? <p className="users-error">{layoutError}</p> : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 300px",
          gap: 18,
          flex: 1,
          minHeight: 0,
        }}
      >
        <section
          style={{
            position: "relative",
            minHeight: 560,
            overflow: "hidden",
            borderRadius: 20,
            border: "1px solid rgba(53, 80, 112, 0.14)",
            background: "radial-gradient(circle at top, rgba(189, 224, 254, 0.18), rgba(255, 255, 255, 0.98) 52%)",
          }}
        >
          <div
            ref={cyContainerRef}
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: [
                "linear-gradient(rgba(53, 80, 112, 0.07) 1px, transparent 1px)",
                "linear-gradient(90deg, rgba(53, 80, 112, 0.07) 1px, transparent 1px)",
              ].join(","),
              backgroundSize: "22px 22px",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 16,
              left: 16,
              maxWidth: 280,
              padding: 14,
              borderRadius: 18,
              background: "rgba(255, 255, 255, 0.94)",
              border: "1px solid rgba(53, 80, 112, 0.12)",
              boxShadow: "0 18px 36px rgba(53, 80, 112, 0.10)",
              backdropFilter: "blur(10px)",
              zIndex: 2,
            }}
          >
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#52606d" }}>
                Graph overview
              </div>
              <div className="auth-hint" style={{ marginTop: 8 }}>
                Drag nodes to refine the layout, click a node or link to inspect it, and use auto layout when the graph changes.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 10 }}>
                {[
                  { label: "Objects", value: Object.keys(canvasNodes).length },
                  { label: "Links", value: relationships.filter((relationship) => (
                    !hiddenCanvasRelationshipIds.includes(relationship.id)
                    && canvasNodes[relationship.fromObjectId]
                    && canvasNodes[relationship.toObjectId]
                  )).length },
                  { label: "Types", value: objectTypes.length },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    style={{
                      padding: 10,
                      borderRadius: 14,
                      background: "rgba(53, 80, 112, 0.06)",
                      border: "1px solid rgba(53, 80, 112, 0.08)",
                    }}
                  >
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#1f2933" }}>{stat.value}</div>
                    <div style={{ fontSize: 12, color: "#52606d" }}>{stat.label}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button type="button" className="btn btn--ghost" onClick={() => cyRef.current?.zoom(Math.min(2.4, (cyRef.current?.zoom() ?? 1) * 1.12))}>
                  Zoom in
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => cyRef.current?.zoom(Math.max(0.3, (cyRef.current?.zoom() ?? 1) / 1.12))}>
                  Zoom out
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => cyRef.current?.fit(undefined, 36)}>
                  Fit
                </button>
              </div>
          </div>
        </section>

        <aside
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            minHeight: 0,
          }}
        >
          <section className="home-project-card" style={{ gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Inspector</h2>
            {selectedObject ? (
              <>
                <div className="auth-hint">Selected object</div>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#52606d" }}>
                  {selectedObject.objectType}
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#1f2933" }}>{selectedObject.title}</div>
                <p style={{ margin: 0, color: "#52606d", lineHeight: 1.5 }}>
                  {selectedObject.description || "No description yet."}
                </p>
              </>
            ) : selectedRelationship ? (
              <>
                <div className="auth-hint">Selected relationship</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#1f2933" }}>{selectedRelationship.relationshipType}</div>
                <p style={{ margin: 0, color: "#52606d", lineHeight: 1.5 }}>
                  {selectedRelationship.description || "No description yet."}
                </p>
              </>
            ) : (
              <p style={{ margin: 0, color: "#52606d", lineHeight: 1.5 }}>
                Select an object or relationship to inspect it here.
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function PostgresExperimentSidebar({
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
  onShowProjectLog,
  onShowProjectObjects,
  onShowProjectRelationships,
  onShowFreeDraw,
  onShowExplore,
  onShowConstruct,
  onShowCanvasView,
  onShowAppSettings,
  onShowProjectSettings,
  onShowUserSettings,
  onBackToGate,
  onSignOut,
  onOpenCurrentApp,
}: {
  activeScreen: "projects" | "home" | "users" | "sources" | "annotations" | "codebook" | "code-text" | "memos" | "project-log" | "objects" | "relationships" | "free-draw" | "explore" | "construct" | "view" | "app-settings" | "project-settings" | "user-settings";
  activeProject: PostgresExperimentProject | null;
  authSession: PostgresExperimentAuthSession;
  onShowProjects?: () => void;
  onShowProjectHome?: () => void;
  onShowProjectUsers?: () => void;
  onShowProjectSources?: () => void;
  onShowProjectAnnotations?: () => void;
  onShowProjectCodebook?: () => void;
  onShowProjectCodeText?: () => void;
  onShowProjectMemos?: () => void;
  onShowProjectLog?: () => void;
  onShowProjectObjects?: () => void;
  onShowProjectRelationships?: () => void;
  onShowFreeDraw?: () => void;
  onShowExplore?: () => void;
  onShowConstruct?: () => void;
  onShowCanvasView?: () => void;
  onShowAppSettings?: () => void;
  onShowProjectSettings?: () => void;
  onShowUserSettings?: () => void;
  onBackToGate: () => void;
  onSignOut: () => Promise<void>;
  onOpenCurrentApp: () => void;
}) {
  const projectItems = [
    { id: "home", label: "Home", disabled: !activeProject, onClick: onShowProjectHome },
    { id: "users", label: "Users", disabled: !activeProject, onClick: onShowProjectUsers },
    { id: "sources", label: "Sources", disabled: !activeProject, onClick: onShowProjectSources },
    { id: "annotations", label: "Annotations", disabled: !activeProject, onClick: onShowProjectAnnotations },
    { id: "codebook", label: "Codebook", disabled: !activeProject, onClick: onShowProjectCodebook },
    { id: "project-log", label: "Log", disabled: !activeProject, onClick: onShowProjectLog },
    { id: "objects", label: "Objects", disabled: !activeProject, onClick: onShowProjectObjects },
    { id: "relationships", label: "Relationships", disabled: !activeProject, onClick: onShowProjectRelationships },
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
  ];
  const settingsItems = [
    { id: "app-settings", label: "App Settings", disabled: false, onClick: onShowAppSettings },
    { id: "project-settings", label: "Project Settings", disabled: !activeProject, onClick: onShowProjectSettings },
    { id: "user-settings", label: "User Settings", disabled: false, onClick: onShowUserSettings },
    { id: "projects", label: "Projects", disabled: false, onClick: onShowProjects },
    { id: "experiment", label: "Back to Gate", disabled: false, onClick: onBackToGate },
    { id: "sign-out", label: "Sign Out", disabled: false, onClick: () => void onSignOut() },
    { id: "current-app", label: "Open Current App", disabled: false, onClick: onOpenCurrentApp },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src={sidebarLogo} alt="Kanqual" className="brand-logo" />
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
          <button type="button" className="sidebar-section-header" aria-expanded="true">
            <span>Project</span>
            <span className="sidebar-section-chevron">{"\u25be"}</span>
          </button>
          <div className="sidebar-section-items">
            {projectItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${activeScreen === item.id ? "nav-item--active" : ""}`}
                onClick={() => item.onClick?.()}
                disabled={item.disabled}
                title={item.disabled ? "Not wired into the PostgreSQL experiment yet." : undefined}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <button type="button" className="sidebar-section-header" aria-expanded="true">
            <span>Analysis</span>
            <span className="sidebar-section-chevron">{"\u25be"}</span>
          </button>
          <div className="sidebar-section-items">
            {analysisItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${activeScreen === item.id ? "nav-item--active" : ""}`}
                onClick={() => item.onClick?.()}
                disabled={item.disabled}
                title={item.disabled ? "Not wired into the PostgreSQL experiment yet." : undefined}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <button type="button" className="sidebar-section-header" aria-expanded="true">
            <span>Settings</span>
            <span className="sidebar-section-chevron">{"\u25be"}</span>
          </button>
          <div className="sidebar-section-items">
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
          <button type="button" className="sidebar-section-header" aria-expanded="true">
            <span>Canvas</span>
            <span className="sidebar-section-chevron">{"\u25be"}</span>
          </button>
          <div className="sidebar-section-items">
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

function PostgresProjectSettingsExperimentView({
  project,
  canManageProject,
  memberCount,
  ownerCount,
  objectCount,
  relationshipCount,
  onProjectUpdated,
  onProjectDeleted,
}: {
  project: PostgresExperimentProject;
  canManageProject: boolean;
  memberCount: number;
  ownerCount: number;
  objectCount: number;
  relationshipCount: number;
  onProjectUpdated: (project: PostgresExperimentProject) => void;
  onProjectDeleted: (projectId: string) => void;
}) {
  const [activeModal, setActiveModal] = useState<"details" | "storage" | "ai-assist" | "document-import" | "danger" | null>(null);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [deleteConfirmationName, setDeleteConfirmationName] = useState("");
  const [submitting, setSubmitting] = useState<"details" | "delete" | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [aiAssistNotice, setAiAssistNotice] = useState("");
  const [documentImportNotice, setDocumentImportNotice] = useState("");
  const [projectAiAssistSettings, setProjectAiAssistSettings] = useState<PostgresExperimentProjectAiAssistSettings>({
    enabled: false,
    allowSemanticSearch: true,
    allowQuestionAnswering: true,
    allowSummaries: true,
    allowCodeSuggestions: false,
    allowDraftReports: false,
  });
  const [projectDocumentImportSettings, setProjectDocumentImportSettings] =
    useState<PostgresExperimentProjectDocumentImportSettings>({
      storeOriginalFileName: true,
    });

  useEffect(() => {
    setName(project.name);
    setDescription(project.description);
  }, [project.description, project.name]);

  useEffect(() => {
    let cancelled = false;

    async function loadProjectSettings() {
      setSettingsLoading(true);
      try {
        const [aiAssistSettings, documentImportSettings] = await Promise.all([
          getPostgresExperimentProjectAiAssistSettings(project.id),
          getPostgresExperimentProjectDocumentImportSettings(project.id),
        ]);
        if (cancelled) return;
        setProjectAiAssistSettings(aiAssistSettings);
        setProjectDocumentImportSettings(documentImportSettings);
      } catch (loadError) {
        if (cancelled) return;
        setError(describeUnknownError(loadError));
      } finally {
        if (!cancelled) {
          setSettingsLoading(false);
        }
      }
    }

    void loadProjectSettings();

    return () => {
      cancelled = true;
    };
  }, [project.id]);

  async function handleSaveAiAssistSettings(next: PostgresExperimentProjectAiAssistSettings) {
    setError("");
    setNotice("");
    setDocumentImportNotice("");
    setAiAssistNotice("");
    if (!canManageProject) {
      setError("Only project owners or the PostgreSQL administrator can change project settings.");
      return;
    }

    try {
      const saved = await savePostgresExperimentProjectAiAssistSettings({
        projectId: project.id,
        settings: next,
      });
      setProjectAiAssistSettings(saved);
      setAiAssistNotice("AI Assist settings saved.");
    } catch (saveError) {
      setError(describeUnknownError(saveError));
    }
  }

  async function handleSaveDocumentImportSettings(next: PostgresExperimentProjectDocumentImportSettings) {
    setError("");
    setNotice("");
    setAiAssistNotice("");
    setDocumentImportNotice("");
    if (!canManageProject) {
      setError("Only project owners or the PostgreSQL administrator can change project settings.");
      return;
    }

    try {
      const saved = await savePostgresExperimentProjectDocumentImportSettings({
        projectId: project.id,
        settings: next,
      });
      setProjectDocumentImportSettings(saved);
      setDocumentImportNotice("Document import defaults saved.");
    } catch (saveError) {
      setError(describeUnknownError(saveError));
    }
  }

  async function handleSaveDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!canManageProject) {
      setError("Only project owners or the PostgreSQL administrator can change project settings.");
      return;
    }
    if (!name.trim()) {
      setError("Enter a project name.");
      return;
    }

    setSubmitting("details");
    try {
      const updated = await updatePostgresExperimentProject({
        projectId: project.id,
        name: name.trim(),
        description: description.trim(),
      });
      onProjectUpdated(updated);
      setActiveModal(null);
      setNotice(`Updated PostgreSQL project "${updated.name}".`);
    } catch (updateError) {
      setError(describeUnknownError(updateError));
    } finally {
      setSubmitting(null);
    }
  }

  async function handleDeleteProject() {
    setError("");
    setNotice("");
    if (!canManageProject) {
      setError("Only project owners or the PostgreSQL administrator can delete this project.");
      return;
    }
    if (deleteConfirmationName.trim() !== project.name.trim()) {
      setError("Enter the exact project name to confirm deletion.");
      return;
    }

    setSubmitting("delete");
    try {
      await deletePostgresExperimentProject(project.id);
      onProjectDeleted(project.id);
    } catch (deleteError) {
      setError(describeUnknownError(deleteError));
      setSubmitting(null);
    }
  }

  return (
    <div className="view project-settings-view">
      <header className="view-header">
        <div className="view-title-with-help">
          <h1>Project Settings</h1>
        </div>
      </header>

      {notice ? <p className="settings-success">{notice}</p> : null}
      {error ? <p className="auth-error">{error}</p> : null}

      <div className="app-settings-overview-shell project-settings-overview-shell">
        <div className="app-settings-overview-stack">
          <div className="app-settings-overview-sections">
            <section className="app-settings-overview-section">
              <div className="app-settings-overview-section-header">
                <p className="app-settings-overview-section-heading">Project</p>
              </div>
              <div className="app-settings-overview-grid">
                <button
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--default"
                  onClick={() => {
                    setError("");
                    setName(project.name);
                    setDescription(project.description);
                    setActiveModal("details");
                  }}
                >
                  <h3>Details</h3>
                  <p>Rename the project and edit its description.</p>
                </button>
                <button
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--default"
                  onClick={() => {
                    setError("");
                    setActiveModal("storage");
                  }}
                >
                  <h3>Storage</h3>
                  <p>See the per-project database name, file location, and timestamps.</p>
                </button>
                <button
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--default"
                  onClick={() => {
                    setError("");
                    setNotice("");
                    setDocumentImportNotice("");
                    setAiAssistNotice("");
                    setActiveModal("ai-assist");
                  }}
                  disabled={settingsLoading}
                >
                  <h3>AI Assist</h3>
                  <p>Choose whether this project allows search, summaries, coding help, and draft reports.</p>
                </button>
                <button
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--default"
                  onClick={() => {
                    setError("");
                    setNotice("");
                    setDocumentImportNotice("");
                    setAiAssistNotice("");
                    setActiveModal("document-import");
                  }}
                  disabled={settingsLoading}
                >
                  <h3>Document Import</h3>
                  <p>Control shared defaults for imported files in this project database.</p>
                </button>
              </div>
            </section>

            <section className="app-settings-overview-section">
              <div className="app-settings-overview-section-header">
                <p className="app-settings-overview-section-heading">Workspace</p>
              </div>
              <div className="app-settings-overview-grid">
                <div className="app-settings-overview-card app-settings-overview-card--default" role="presentation">
                  <h3>Project Summary</h3>
                  <p>
                    {memberCount} users, {objectCount} objects, and {relationshipCount} relationships currently live in
                    this PostgreSQL project database.
                  </p>
                </div>
                <button
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--danger"
                  onClick={() => {
                    setError("");
                    setDeleteConfirmationName("");
                    setActiveModal("danger");
                  }}
                >
                  <h3>Delete Project</h3>
                  <p>Permanently remove this project and its dedicated PostgreSQL database.</p>
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>

      {activeModal === "details" ? (
        <div className="modal-overlay" onClick={() => submitting !== "details" && setActiveModal(null)}>
          <div className="modal modal--wide app-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">Project Details</h2>
              </div>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Metadata</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <form className="form" onSubmit={handleSaveDetails}>
                      <label className="form-label">
                        Project name
                        <input
                          className="form-input"
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          disabled={submitting === "details" || !canManageProject}
                          autoFocus
                        />
                      </label>
                      <label className="form-label">
                        Description
                        <textarea
                          className="form-input form-textarea"
                          rows={5}
                          value={description}
                          onChange={(event) => setDescription(event.target.value)}
                          disabled={submitting === "details" || !canManageProject}
                        />
                      </label>
                      {!canManageProject ? (
                        <p className="auth-hint" style={{ marginTop: 0 }}>
                          Only project owners or the PostgreSQL administrator can change these settings.
                        </p>
                      ) : null}
                      <div className="form-actions">
                        <button
                          type="button"
                          className="btn"
                          onClick={() => setActiveModal(null)}
                          disabled={submitting === "details"}
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="btn btn--primary"
                          disabled={submitting === "details" || !canManageProject || !name.trim()}
                        >
                          {submitting === "details" ? "Saving..." : "Save changes"}
                        </button>
                      </div>
                    </form>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === "storage" ? (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal modal--wide app-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">Project Storage</h2>
              </div>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Dedicated Database</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="home-restricted-list">
                      <div className="home-restricted-item">
                        <span className="home-restricted-label">Database name</span>
                        <span className="home-restricted-value">{project.databaseName || "-"}</span>
                      </div>
                      <div className="home-restricted-item">
                        <span className="home-restricted-label">Storage path</span>
                        <span className="home-restricted-value" style={{ textAlign: "right", overflowWrap: "anywhere" }}>
                          {project.storagePath || "-"}
                        </span>
                      </div>
                      <div className="home-restricted-item">
                        <span className="home-restricted-label">Created</span>
                        <span className="home-restricted-value">{formatPostgresExperimentDateTime(project.createdAt)}</span>
                      </div>
                      <div className="home-restricted-item">
                        <span className="home-restricted-label">Last updated</span>
                        <span className="home-restricted-value">{formatPostgresExperimentDateTime(project.updatedAt)}</span>
                      </div>
                      <div className="home-restricted-item">
                        <span className="home-restricted-label">Owners</span>
                        <span className="home-restricted-value">{ownerCount}</span>
                      </div>
                      <div className="home-restricted-item">
                        <span className="home-restricted-label">Members</span>
                        <span className="home-restricted-value">{memberCount}</span>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === "ai-assist" ? (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal modal--wide app-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">AI Assist</h2>
              </div>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Project AI permissions</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    {aiAssistNotice ? <p className="settings-success">{aiAssistNotice}</p> : null}
                    <label className="settings-toggle-row">
                      <span>
                        <strong>Enable AI Assist for this project</strong>
                      </span>
                      <input
                        type="checkbox"
                        checked={projectAiAssistSettings.enabled}
                        disabled={!canManageProject}
                        onChange={(event) => void handleSaveAiAssistSettings({
                          ...projectAiAssistSettings,
                          enabled: event.target.checked,
                        })}
                      />
                    </label>
                    <label className="settings-toggle-row">
                      <span>Allow semantic search</span>
                      <input
                        type="checkbox"
                        checked={projectAiAssistSettings.allowSemanticSearch}
                        disabled={!canManageProject}
                        onChange={(event) => void handleSaveAiAssistSettings({
                          ...projectAiAssistSettings,
                          allowSemanticSearch: event.target.checked,
                        })}
                      />
                    </label>
                    <label className="settings-toggle-row">
                      <span>Allow question answering</span>
                      <input
                        type="checkbox"
                        checked={projectAiAssistSettings.allowQuestionAnswering}
                        disabled={!canManageProject}
                        onChange={(event) => void handleSaveAiAssistSettings({
                          ...projectAiAssistSettings,
                          allowQuestionAnswering: event.target.checked,
                        })}
                      />
                    </label>
                    <label className="settings-toggle-row">
                      <span>Allow summaries</span>
                      <input
                        type="checkbox"
                        checked={projectAiAssistSettings.allowSummaries}
                        disabled={!canManageProject}
                        onChange={(event) => void handleSaveAiAssistSettings({
                          ...projectAiAssistSettings,
                          allowSummaries: event.target.checked,
                        })}
                      />
                    </label>
                    <label className="settings-toggle-row">
                      <span>Allow code suggestions</span>
                      <input
                        type="checkbox"
                        checked={projectAiAssistSettings.allowCodeSuggestions}
                        disabled={!canManageProject}
                        onChange={(event) => void handleSaveAiAssistSettings({
                          ...projectAiAssistSettings,
                          allowCodeSuggestions: event.target.checked,
                        })}
                      />
                    </label>
                    <label className="settings-toggle-row">
                      <span>Allow draft reports</span>
                      <input
                        type="checkbox"
                        checked={projectAiAssistSettings.allowDraftReports}
                        disabled={!canManageProject}
                        onChange={(event) => void handleSaveAiAssistSettings({
                          ...projectAiAssistSettings,
                          allowDraftReports: event.target.checked,
                        })}
                      />
                    </label>
                    {!canManageProject ? (
                      <p className="auth-hint" style={{ marginTop: 12 }}>
                        Only project owners or the PostgreSQL administrator can change these settings.
                      </p>
                    ) : null}
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === "document-import" ? (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal modal--wide app-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">Document Import</h2>
              </div>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Shared import defaults</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    {documentImportNotice ? <p className="settings-success">{documentImportNotice}</p> : null}
                    <label className="settings-toggle-row">
                      <span>
                        <strong>Store original filename</strong>
                      </span>
                      <input
                        type="checkbox"
                        checked={projectDocumentImportSettings.storeOriginalFileName}
                        disabled={!canManageProject}
                        onChange={(event) => void handleSaveDocumentImportSettings({
                          storeOriginalFileName: event.target.checked,
                        })}
                      />
                    </label>
                    {!canManageProject ? (
                      <p className="auth-hint" style={{ marginTop: 12 }}>
                        Only project owners or the PostgreSQL administrator can change these settings.
                      </p>
                    ) : null}
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === "danger" ? (
        <div className="modal-overlay" onClick={() => submitting !== "delete" && setActiveModal(null)}>
          <div className="modal app-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">Delete Project</h2>
              </div>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--danger">
                    <h3>Danger Zone</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <p className="import-project-copy">
                      This permanently deletes <strong>{project.name}</strong>, including its dedicated PostgreSQL
                      database, objects, relationships, and project memberships.
                    </p>
                    <label className="form-label">
                      Type the project name to confirm
                      <input
                        className="form-input"
                        value={deleteConfirmationName}
                        onChange={(event) => setDeleteConfirmationName(event.target.value)}
                        disabled={submitting === "delete" || !canManageProject}
                        autoFocus
                      />
                    </label>
                    {!canManageProject ? (
                      <p className="auth-hint" style={{ marginTop: 0 }}>
                        Only project owners or the PostgreSQL administrator can delete this project.
                      </p>
                    ) : null}
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <button
                type="button"
                className="btn"
                onClick={() => setActiveModal(null)}
                disabled={submitting === "delete"}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => void handleDeleteProject()}
                disabled={submitting === "delete" || !canManageProject || deleteConfirmationName.trim() !== project.name.trim()}
              >
                {submitting === "delete" ? "Deleting..." : "Delete project"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PostgresAppSettingsExperimentView({
  authSession,
}: {
  authSession: PostgresExperimentAuthSession;
}) {
  const { locale } = useI18n();
  const [activeModal, setActiveModal] = useState<"startup" | "import" | "privacy" | "updates" | "llm" | "postgres" | null>(null);
  const [showThemeManager, setShowThemeManager] = useState(false);
  const [installationSettings, setInstallationSettings] = useState<PostgresExperimentInstallationSettings | null>(null);
  const [status, setStatus] = useState<PostgresExperimentStatus | null>(null);
  const [authStatus, setAuthStatus] = useState<PostgresExperimentAuthStatus | null>(null);
  const [projects, setProjects] = useState<PostgresExperimentProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [theme, setTheme] = useState<Theme>("light");
  const [density, setDensity] = useState<Density>("comfortable");
  const [fontSize, setFontSize] = useState<FontSize>("normal");
  const [recentProjectLimit, setRecentProjectLimit] = useState(10);

  const persistInstallationSettings = useCallback(async (
    next: PostgresExperimentInstallationSettings,
    successMessage: string,
  ) => {
    const saved = await savePostgresExperimentInstallationSettings(next);
    setInstallationSettings(saved);
    syncLegacyAppSettingsFromPostgresInstallationSettings(saved);
    setNotice(successMessage);
    setError("");
  }, []);

  const persistUserPreferences = useCallback(async (
    next: PostgresExperimentUserPreferences,
    successMessage?: string,
  ) => {
    const saved = await savePostgresExperimentUserPreferences(next);
    setTheme(saved.theme);
    setDensity(saved.density);
    setFontSize(saved.fontSize);
    setRecentProjectLimit(saved.recentProjectLimit);
    applyPostgresRuntimeThemePreferences(saved);
    if (successMessage) setNotice(successMessage);
    setError("");
  }, []);

  const refreshPostgresDetails = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [
        nextStatus,
        nextAuthStatus,
        nextProjects,
        nextInstallationSettings,
        nextUserPreferences,
      ] = await Promise.all([
        getPostgresExperimentStatus(),
        getPostgresExperimentAuthStatus(),
        listPostgresExperimentProjects(),
        getPostgresExperimentInstallationSettings(),
        getPostgresExperimentUserPreferences(),
      ]);
      setStatus(nextStatus);
      setAuthStatus(nextAuthStatus);
      setProjects(nextProjects);
      setInstallationSettings(nextInstallationSettings);
      syncLegacyAppSettingsFromPostgresInstallationSettings(nextInstallationSettings);
      setTheme(nextUserPreferences.theme);
      setDensity(nextUserPreferences.density);
      setFontSize(nextUserPreferences.fontSize);
      setRecentProjectLimit(nextUserPreferences.recentProjectLimit);
      applyPostgresRuntimeThemePreferences(nextUserPreferences);
    } catch (loadError) {
      setError(describeUnknownError(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPostgresDetails();
  }, [refreshPostgresDetails]);

  function handleTheme(nextTheme: Theme) {
    setTheme(nextTheme);
    setActivePresetId(null);
    applyTheme(nextTheme);
    const nextPreferences: PostgresExperimentUserPreferences = {
      theme: nextTheme,
      density: density,
      fontSize: fontSize,
      locale,
      recentProjectLimit,
      themeState: getStoredThemeState(),
    };
    void persistUserPreferences(nextPreferences);
  }

  function handleDensity(nextDensity: Density) {
    setDensity(nextDensity);
    applyDensity(nextDensity);
    const nextPreferences: PostgresExperimentUserPreferences = {
      theme,
      density: nextDensity,
      fontSize: fontSize,
      locale,
      recentProjectLimit,
      themeState: getStoredThemeState(),
    };
    void persistUserPreferences(nextPreferences);
  }

  function handleFontSize(nextFontSize: FontSize) {
    setFontSize(nextFontSize);
    applyFontSize(nextFontSize);
    const nextPreferences: PostgresExperimentUserPreferences = {
      theme,
      density,
      fontSize: nextFontSize,
      locale,
      recentProjectLimit,
      themeState: getStoredThemeState(),
    };
    void persistUserPreferences(nextPreferences);
  }

  async function handleThemeManagerApplied() {
    const nextTheme = getStoredTheme();
    setTheme(nextTheme);
    setActivePresetId(null);
    await persistUserPreferences({
      theme: nextTheme,
      density,
      fontSize,
      locale,
      recentProjectLimit,
      themeState: getStoredThemeState(),
    }, "Theme updated.");
  }

  return (
    <div className="view app-settings-view">
      <header className="view-header">
        <div className="view-title-with-help">
          <h1>App Settings</h1>
        </div>
      </header>

      {notice ? <p className="settings-success">{notice}</p> : null}
      {error ? <p className="auth-error">{error}</p> : null}

      <div className="app-settings-overview-shell">
        <div className="app-settings-overview-stack">
          <div className="app-settings-overview-sections">
            <section className="app-settings-overview-section">
              <div className="app-settings-overview-section-header">
                <p className="app-settings-overview-section-heading">Kanqual</p>
              </div>
              <div className="app-settings-overview-grid">
                <button
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--default"
                  onClick={() => setActiveModal("startup")}
                >
                  <h3>Startup</h3>
                  <p>Control remembered sign-in and other launch behavior for this device.</p>
                </button>
                <button
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--default"
                  onClick={() => setActiveModal("import")}
                >
                  <h3>Document Import</h3>
                  <p>Set shared defaults for uploading, naming, and cleaning imported text.</p>
                </button>
                <button
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--default"
                  onClick={() => setActiveModal("privacy")}
                >
                  <h3>Privacy</h3>
                  <p>Choose what Kanqual remembers locally and what it clears on sign-out.</p>
                </button>
                <button
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--default"
                  onClick={() => setActiveModal("updates")}
                >
                  <h3>Appearance & Updates</h3>
                  <p>Adjust the interface and background update-check behavior.</p>
                </button>
                <button
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--default"
                  onClick={() => setActiveModal("llm")}
                >
                  <h3>AI Assist Runtime</h3>
                  <p>Persist local and cloud LLM defaults for the PostgreSQL experiment in PostgreSQL.</p>
                </button>
                <button
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--default"
                  onClick={() => setActiveModal("postgres")}
                >
                  <h3>PostgreSQL Experiment</h3>
                  <p>Review local PostgreSQL status, registered users, and project databases.</p>
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>

      {activeModal === "startup" ? (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal modal--wide app-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">Startup</h2>
              </div>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Launch Behavior</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <label className="settings-toggle-row">
                      <span>
                        <strong>Persist signed-in users</strong>
                        <small>Keep the most recent PostgreSQL or PocketBase session signed in across launches.</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={installationSettings?.startupAutoLoginLastUser ?? false}
                        onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings(
                            {
                              ...installationSettings,
                              startupAutoLoginLastUser: event.target.checked,
                            },
                            "Startup behavior saved.",
                          );
                        }}
                      />
                    </label>
                    <label className="settings-toggle-row">
                      <span>
                        <strong>Reopen last project on launch</strong>
                        <small>If the last project still exists, Kanqual will reopen it after sign-in.</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={installationSettings?.startupReopenLastProject ?? false}
                        onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings(
                            {
                              ...installationSettings,
                              startupReopenLastProject: event.target.checked,
                            },
                            "Startup behavior saved.",
                          );
                        }}
                      />
                    </label>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <p className="app-settings-modal-footer-note">Changes are saved immediately.</p>
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === "import" ? (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal modal--wide app-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">Document Import</h2>
              </div>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Shared Defaults</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <div className="settings-row-label">Default import mode</div>
                        <div className="settings-row-desc">Choose whether new imports start in upload or paste mode.</div>
                      </div>
                      <div className="theme-options">
                        {(["upload", "paste"] as const).map((option) => (
                          <button
                            key={option}
                            type="button"
                            className={`theme-option ${(installationSettings?.documentImportDefaultMode ?? "upload") === option ? "theme-option--active" : ""}`}
                            onClick={() => {
                              if (!installationSettings) return;
                              void persistInstallationSettings(
                                {
                                  ...installationSettings,
                                  documentImportDefaultMode: option,
                                },
                                "Document import defaults saved.",
                              );
                            }}
                          >
                            {option === "upload" ? "Upload" : "Paste"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label className="settings-toggle-row">
                      <span>
                        <strong>Auto-name from file</strong>
                        <small>Use the source filename as the starting document name when possible.</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={installationSettings?.documentImportAutoNameFromFile ?? true}
                        onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings(
                            {
                              ...installationSettings,
                              documentImportAutoNameFromFile: event.target.checked,
                            },
                            "Document import defaults saved.",
                          );
                        }}
                      />
                    </label>
                    <label className="settings-toggle-row">
                      <span>
                        <strong>Trim imported text</strong>
                        <small>Remove leading and trailing whitespace from imported text by default.</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={installationSettings?.documentImportTrimImportedText ?? true}
                        onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings(
                            {
                              ...installationSettings,
                              documentImportTrimImportedText: event.target.checked,
                            },
                            "Document import defaults saved.",
                          );
                        }}
                      />
                    </label>
                    <label className="settings-toggle-row">
                      <span>
                        <strong>Warn before empty import</strong>
                        <small>Show a confirmation when an import would create an empty document.</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={installationSettings?.documentImportWarnBeforeEmptyImport ?? true}
                        onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings(
                            {
                              ...installationSettings,
                              documentImportWarnBeforeEmptyImport: event.target.checked,
                            },
                            "Document import defaults saved.",
                          );
                        }}
                      />
                    </label>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <p className="app-settings-modal-footer-note">Changes are saved immediately.</p>
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === "privacy" ? (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal modal--wide app-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">Privacy</h2>
              </div>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Local Data</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <label className="settings-toggle-row">
                      <span>
                        <strong>Mask file paths</strong>
                        <small>Hide full local paths in interface text when possible.</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={installationSettings?.privacyMaskFilePaths ?? false}
                        onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings(
                            {
                              ...installationSettings,
                              privacyMaskFilePaths: event.target.checked,
                            },
                            "Privacy settings saved.",
                          );
                        }}
                      />
                    </label>
                    <label className="settings-toggle-row">
                      <span>
                        <strong>Clear recent projects on sign-out</strong>
                        <small>Forget the locally stored recent project list when you sign out.</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={installationSettings?.privacyClearRecentProjectsOnSignOut ?? false}
                        onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings(
                            {
                              ...installationSettings,
                              privacyClearRecentProjectsOnSignOut: event.target.checked,
                            },
                            "Privacy settings saved.",
                          );
                        }}
                      />
                    </label>
                    <label className="settings-toggle-row">
                      <span>
                        <strong>Forget login identities on logout</strong>
                        <small>Remove remembered login identities when you sign out.</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={installationSettings?.privacyForgetLoginIdentitiesOnLogout ?? false}
                        onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings(
                            {
                              ...installationSettings,
                              privacyForgetLoginIdentitiesOnLogout: event.target.checked,
                            },
                            "Privacy settings saved.",
                          );
                        }}
                      />
                    </label>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <p className="app-settings-modal-footer-note">Changes are saved immediately.</p>
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === "updates" ? (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal modal--wide app-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">Appearance & Updates</h2>
              </div>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Appearance</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <div className="settings-row-label">Theme</div>
                        <div className="settings-row-desc">Switch between light and dark mode.</div>
                      </div>
                      <div className="theme-options">
                        {(["light", "dark"] as Theme[]).map((option) => (
                          <button
                            key={option}
                            type="button"
                            className={`theme-option${theme === option ? " theme-option--active" : ""}`}
                            onClick={() => handleTheme(option)}
                          >
                            {option === "light" ? "Light" : "Dark"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <div className="settings-row-label">Interface density</div>
                        <div className="settings-row-desc">Choose a more spacious or compact layout.</div>
                      </div>
                      <div className="segmented-control">
                        {(["comfortable", "compact"] as Density[]).map((option) => (
                          <button
                            key={option}
                            type="button"
                            className={density === option ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                            onClick={() => handleDensity(option)}
                          >
                            {option === "comfortable" ? "Comfortable" : "Compact"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <div className="settings-row-label">Text size</div>
                        <div className="settings-row-desc">Adjust default interface text size.</div>
                      </div>
                      <div className="segmented-control">
                        {(["small", "normal", "large"] as FontSize[]).map((option) => (
                          <button
                            key={option}
                            type="button"
                            className={fontSize === option ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                            onClick={() => handleFontSize(option)}
                          >
                            {option === "small" ? "Small" : option === "normal" ? "Normal" : "Large"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <div className="settings-row-label">Custom theme</div>
                        <div className="settings-row-desc">Edit saved presets, color overrides, corner radius, and border width for this device.</div>
                      </div>
                      <button type="button" className="btn" onClick={() => setShowThemeManager(true)}>
                        Edit theme
                      </button>
                    </div>
                  </div>
                </section>
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Updates</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <label className="settings-toggle-row">
                      <span>
                        <strong>Check for updates automatically</strong>
                        <small>Allow Kanqual to check for newer releases in the background.</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={installationSettings?.updatesAutoCheck ?? true}
                        onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings(
                            {
                              ...installationSettings,
                              updatesAutoCheck: event.target.checked,
                            },
                            "Update preferences saved.",
                          );
                        }}
                      />
                    </label>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <p className="app-settings-modal-footer-note">Changes are saved immediately.</p>
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === "llm" ? (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal modal--wide app-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">AI Assist Runtime</h2>
              </div>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Embedding Defaults</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="llm-settings-grid">
                      <label className="form-label">
                        Chunk size
                        <input
                          className="form-input"
                          type="number"
                          min={100}
                          max={20000}
                          value={installationSettings?.llm.chunkSize ?? 1800}
                          onChange={(event) => {
                            if (!installationSettings) return;
                            const chunkSize = clampIntegerValue(Number(event.target.value), 100, 20000);
                            void persistInstallationSettings({
                              ...installationSettings,
                              llm: {
                                ...installationSettings.llm,
                                chunkSize,
                                overlapSize: Math.min(installationSettings.llm.overlapSize, Math.max(0, chunkSize - 1)),
                              },
                            }, "LLM settings saved.");
                          }}
                        />
                      </label>
                      <label className="form-label">
                        Overlap size
                        <input
                          className="form-input"
                          type="number"
                          min={0}
                          max={Math.max(0, (installationSettings?.llm.chunkSize ?? 1800) - 1)}
                          value={installationSettings?.llm.overlapSize ?? 100}
                          onChange={(event) => {
                            if (!installationSettings) return;
                            void persistInstallationSettings({
                              ...installationSettings,
                              llm: {
                                ...installationSettings.llm,
                                overlapSize: clampIntegerValue(
                                  Number(event.target.value),
                                  0,
                                  Math.max(0, installationSettings.llm.chunkSize - 1),
                                ),
                              },
                            }, "LLM settings saved.");
                          }}
                        />
                      </label>
                      <label className="form-label">
                        Batch size
                        <input
                          className="form-input"
                          type="number"
                          min={1}
                          max={256}
                          value={installationSettings?.llm.batchSize ?? 16}
                          onChange={(event) => {
                            if (!installationSettings) return;
                            void persistInstallationSettings({
                              ...installationSettings,
                              llm: {
                                ...installationSettings.llm,
                                batchSize: clampIntegerValue(Number(event.target.value), 1, 256),
                              },
                            }, "LLM settings saved.");
                          }}
                        />
                      </label>
                    </div>
                    <label className="settings-toggle-row">
                      <span><strong>Prefix passages</strong></span>
                      <input
                        type="checkbox"
                        checked={installationSettings?.llm.prefixPassages ?? true}
                        onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings({
                            ...installationSettings,
                            llm: { ...installationSettings.llm, prefixPassages: event.target.checked },
                          }, "LLM settings saved.");
                        }}
                      />
                    </label>
                    <label className="settings-toggle-row">
                      <span><strong>Prefix queries</strong></span>
                      <input
                        type="checkbox"
                        checked={installationSettings?.llm.prefixQueries ?? true}
                        onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings({
                            ...installationSettings,
                            llm: { ...installationSettings.llm, prefixQueries: event.target.checked },
                          }, "LLM settings saved.");
                        }}
                      />
                    </label>
                    <label className="settings-toggle-row">
                      <span><strong>Normalize whitespace</strong></span>
                      <input
                        type="checkbox"
                        checked={installationSettings?.llm.normalizeWhitespace ?? true}
                        onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings({
                            ...installationSettings,
                            llm: { ...installationSettings.llm, normalizeWhitespace: event.target.checked },
                          }, "LLM settings saved.");
                        }}
                      />
                    </label>
                  </div>
                </section>

                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Connection Mode</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <label className="form-label">
                      AI runtime source
                      <select
                        className="form-input"
                        value={installationSettings?.llm.connectionMode ?? "none"}
                        onChange={(event) => {
                          if (!installationSettings) return;
                          const connectionMode = event.target.value === "local" || event.target.value === "cloud"
                            ? event.target.value
                            : "none";
                          void persistInstallationSettings({
                            ...installationSettings,
                            llm: {
                              ...installationSettings.llm,
                              connectionMode,
                              ollamaEnabled: connectionMode === "local",
                            },
                          }, "LLM settings saved.");
                        }}
                      >
                        <option value="none">None</option>
                        <option value="local">Local</option>
                        <option value="cloud">Cloud</option>
                      </select>
                    </label>
                    <div className="llm-settings-grid">
                      <label className="form-label">
                        Cloud provider
                        <select
                          className="form-input"
                          value={installationSettings?.llm.cloudProvider ?? "openai"}
                          onChange={(event) => {
                            if (!installationSettings) return;
                            void persistInstallationSettings({
                              ...installationSettings,
                              llm: {
                                ...installationSettings.llm,
                                cloudProvider: event.target.value as typeof installationSettings.llm.cloudProvider,
                              },
                            }, "LLM settings saved.");
                          }}
                        >
                          <option value="openai">OpenAI</option>
                          <option value="anthropic">Anthropic</option>
                          <option value="copilot">Copilot</option>
                          <option value="blablador">Blablador</option>
                          <option value="ollama">Ollama</option>
                        </select>
                      </label>
                      <label className="form-label">
                        Cloud model
                        <input
                          className="form-input"
                          value={installationSettings?.llm.cloudSelectedModel ?? ""}
                          onChange={(event) => {
                            if (!installationSettings) return;
                            void persistInstallationSettings({
                              ...installationSettings,
                              llm: { ...installationSettings.llm, cloudSelectedModel: event.target.value },
                            }, "LLM settings saved.");
                          }}
                        />
                      </label>
                    </div>
                    <label className="form-label">
                      Cloud API secret
                      <input
                        className="form-input"
                        type="password"
                        value={installationSettings?.llm.cloudApiSecret ?? ""}
                        onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings({
                            ...installationSettings,
                            llm: { ...installationSettings.llm, cloudApiSecret: event.target.value },
                          }, "LLM settings saved.");
                        }}
                      />
                    </label>
                  </div>
                </section>

                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Local Runtime Defaults</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="llm-settings-grid">
                      <label className="form-label">
                        Protocol
                        <select
                          className="form-input"
                          value={installationSettings?.llm.ollamaProtocol ?? "http"}
                          onChange={(event) => {
                            if (!installationSettings) return;
                            void persistInstallationSettings({
                              ...installationSettings,
                              llm: {
                                ...installationSettings.llm,
                                ollamaProtocol: event.target.value === "https" ? "https" : "http",
                              },
                            }, "LLM settings saved.");
                          }}
                        >
                          <option value="http">http</option>
                          <option value="https">https</option>
                        </select>
                      </label>
                      <label className="form-label">
                        Host
                        <input
                          className="form-input"
                          value={installationSettings?.llm.ollamaHost ?? "127.0.0.1"}
                          onChange={(event) => {
                            if (!installationSettings) return;
                            void persistInstallationSettings({
                              ...installationSettings,
                              llm: { ...installationSettings.llm, ollamaHost: event.target.value },
                            }, "LLM settings saved.");
                          }}
                        />
                      </label>
                      <label className="form-label">
                        Port
                        <input
                          className="form-input"
                          type="number"
                          min={1}
                          max={65535}
                          value={installationSettings?.llm.ollamaPort ?? 11434}
                          onChange={(event) => {
                            if (!installationSettings) return;
                            void persistInstallationSettings({
                              ...installationSettings,
                              llm: { ...installationSettings.llm, ollamaPort: clampIntegerValue(Number(event.target.value), 1, 65535) },
                            }, "LLM settings saved.");
                          }}
                        />
                      </label>
                      <label className="form-label">
                        Selected local model
                        <input
                          className="form-input"
                          value={installationSettings?.llm.ollamaSelectedModel ?? ""}
                          onChange={(event) => {
                            if (!installationSettings) return;
                            void persistInstallationSettings({
                              ...installationSettings,
                              llm: { ...installationSettings.llm, ollamaSelectedModel: event.target.value },
                            }, "LLM settings saved.");
                          }}
                        />
                      </label>
                      <label className="form-label">
                        Request timeout (seconds)
                        <input
                          className="form-input"
                          type="number"
                          min={5}
                          max={600}
                          value={installationSettings?.llm.ollamaRequestTimeoutSeconds ?? 120}
                          onChange={(event) => {
                            if (!installationSettings) return;
                            void persistInstallationSettings({
                              ...installationSettings,
                              llm: {
                                ...installationSettings.llm,
                                ollamaRequestTimeoutSeconds: clampIntegerValue(Number(event.target.value), 5, 600),
                              },
                            }, "LLM settings saved.");
                          }}
                        />
                      </label>
                      <label className="form-label">
                        Document timeout (seconds)
                        <input
                          className="form-input"
                          type="number"
                          min={30}
                          max={3600}
                          value={installationSettings?.llm.ollamaDocumentProcessingTimeoutSeconds ?? 1800}
                          onChange={(event) => {
                            if (!installationSettings) return;
                            void persistInstallationSettings({
                              ...installationSettings,
                              llm: {
                                ...installationSettings.llm,
                                ollamaDocumentProcessingTimeoutSeconds: clampIntegerValue(Number(event.target.value), 30, 3600),
                              },
                            }, "LLM settings saved.");
                          }}
                        />
                      </label>
                      <label className="form-label">
                        Temperature
                        <input
                          className="form-input"
                          type="number"
                          min={0}
                          max={2}
                          step={0.1}
                          value={installationSettings?.llm.ollamaTemperature ?? 0.2}
                          onChange={(event) => {
                            if (!installationSettings) return;
                            const temperature = Number(event.target.value);
                            void persistInstallationSettings({
                              ...installationSettings,
                              llm: {
                                ...installationSettings.llm,
                                ollamaTemperature: Number.isFinite(temperature) ? Math.max(0, Math.min(2, temperature)) : 0,
                              },
                            }, "LLM settings saved.");
                          }}
                        />
                      </label>
                      <label className="form-label">
                        Context window
                        <input
                          className="form-input"
                          type="number"
                          min={256}
                          max={131072}
                          value={installationSettings?.llm.ollamaNumCtx ?? 8192}
                          onChange={(event) => {
                            if (!installationSettings) return;
                            void persistInstallationSettings({
                              ...installationSettings,
                              llm: { ...installationSettings.llm, ollamaNumCtx: clampIntegerValue(Number(event.target.value), 256, 131072) },
                            }, "LLM settings saved.");
                          }}
                        />
                      </label>
                      <label className="form-label">
                        Keep alive (minutes)
                        <input
                          className="form-input"
                          type="number"
                          min={0}
                          max={1440}
                          value={installationSettings?.llm.ollamaKeepAliveMinutes ?? 10}
                          onChange={(event) => {
                            if (!installationSettings) return;
                            void persistInstallationSettings({
                              ...installationSettings,
                              llm: {
                                ...installationSettings.llm,
                                ollamaKeepAliveMinutes: clampIntegerValue(Number(event.target.value), 0, 1440),
                              },
                            }, "LLM settings saved.");
                          }}
                        />
                      </label>
                      <label className="form-label">
                        Relevant-segment shortlist
                        <input
                          className="form-input"
                          type="number"
                          min={1}
                          max={50}
                          value={installationSettings?.llm.ollamaRelevantSegmentsCandidateLimit ?? 12}
                          onChange={(event) => {
                            if (!installationSettings) return;
                            const candidateLimit = clampIntegerValue(Number(event.target.value), 1, 50);
                            void persistInstallationSettings({
                              ...installationSettings,
                              llm: {
                                ...installationSettings.llm,
                                ollamaRelevantSegmentsCandidateLimit: candidateLimit,
                                ollamaRelevantSegmentsMaxResults: Math.min(
                                  installationSettings.llm.ollamaRelevantSegmentsMaxResults,
                                  candidateLimit,
                                ),
                              },
                            }, "LLM settings saved.");
                          }}
                        />
                      </label>
                      <label className="form-label">
                        Relevant segments returned
                        <input
                          className="form-input"
                          type="number"
                          min={1}
                          max={installationSettings?.llm.ollamaRelevantSegmentsCandidateLimit ?? 12}
                          value={installationSettings?.llm.ollamaRelevantSegmentsMaxResults ?? 6}
                          onChange={(event) => {
                            if (!installationSettings) return;
                            void persistInstallationSettings({
                              ...installationSettings,
                              llm: {
                                ...installationSettings.llm,
                                ollamaRelevantSegmentsMaxResults: clampIntegerValue(
                                  Number(event.target.value),
                                  1,
                                  installationSettings.llm.ollamaRelevantSegmentsCandidateLimit,
                                ),
                              },
                            }, "LLM settings saved.");
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <p className="app-settings-modal-footer-note">Changes are saved immediately.</p>
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === "postgres" ? (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal modal--wide app-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">PostgreSQL Experiment</h2>
              </div>
              <button type="button" className="btn" onClick={() => void refreshPostgresDetails()} disabled={loading}>
                {loading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Current Session</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="home-restricted-list">
                      <div className="home-restricted-item">
                        <span className="home-restricted-label">Signed in as</span>
                        <span className="home-restricted-value">{authSession.user.name}</span>
                      </div>
                      <div className="home-restricted-item">
                        <span className="home-restricted-label">Role</span>
                        <span className="home-restricted-value">{authSession.authKind === "postgres_admin" ? "Local administrator" : authSession.user.role}</span>
                      </div>
                      <div className="home-restricted-item">
                        <span className="home-restricted-label">Session started</span>
                        <span className="home-restricted-value">{formatPostgresExperimentDateTime(new Date(authSession.startedAtMs).toISOString())}</span>
                      </div>
                    </div>
                  </div>
                </section>
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Local PostgreSQL</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="home-restricted-list">
                      <div className="home-restricted-item">
                        <span className="home-restricted-label">Host</span>
                        <span className="home-restricted-value">{status ? `${status.host}:${status.port}` : "-"}</span>
                      </div>
                      <div className="home-restricted-item">
                        <span className="home-restricted-label">Reachable</span>
                        <span className="home-restricted-value">{status?.serviceReachable ? "Yes" : "No"}</span>
                      </div>
                      <div className="home-restricted-item">
                        <span className="home-restricted-label">Bootstrap applied</span>
                        <span className="home-restricted-value">{status?.bootstrapApplied ? "Yes" : "No"}</span>
                      </div>
                      <div className="home-restricted-item">
                        <span className="home-restricted-label">Admin handoff complete</span>
                        <span className="home-restricted-value">{status?.adminHandoffCompleted ? "Yes" : "No"}</span>
                      </div>
                      <div className="home-restricted-item">
                        <span className="home-restricted-label">App role</span>
                        <span className="home-restricted-value">{status ? `${status.appRoleName} -> ${status.appDatabase}` : "-"}</span>
                      </div>
                    </div>
                  </div>
                </section>
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Workspace Summary</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="home-restricted-list">
                      <div className="home-restricted-item">
                        <span className="home-restricted-label">Registered users</span>
                        <span className="home-restricted-value">{authStatus?.registeredUserCount ?? "-"}</span>
                      </div>
                      <div className="home-restricted-item">
                        <span className="home-restricted-label">Project databases</span>
                        <span className="home-restricted-value">{projects.length}</span>
                      </div>
                    </div>
                    {projects.length > 0 ? (
                      <div className="users-table-wrap postgres-users-table-wrap" style={{ marginTop: 16, maxHeight: 280 }}>
                        <table className="users-table">
                          <thead>
                            <tr>
                              <th className="users-th">Project</th>
                              <th className="users-th">Database</th>
                              <th className="users-th">Updated</th>
                            </tr>
                          </thead>
                          <tbody>
                            {projects.map((project) => (
                              <tr key={project.id} className="users-row">
                                <td className="users-td users-td--name">{project.name}</td>
                                <td className="users-td users-td--muted">{project.databaseName}</td>
                                <td className="users-td users-td--muted">{formatPostgresExperimentDateTime(project.updatedAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="auth-hint" style={{ marginTop: 12 }}>No PostgreSQL project databases have been created yet.</p>
                    )}
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showThemeManager ? (
        <ThemeManagerModal
          onClose={() => setShowThemeManager(false)}
          onApplied={() => void handleThemeManagerApplied()}
          onCanceled={() => {
            setTheme(getStoredTheme());
          }}
        />
      ) : null}
    </div>
  );
}

function PostgresUserSettingsExperimentView({
  authSession,
  onAuthSessionUpdated,
}: {
  authSession: PostgresExperimentAuthSession;
  onAuthSessionUpdated: (session: PostgresExperimentAuthSession) => void;
}) {
  const { locale, setLocale } = useI18n();
  const [activeModal, setActiveModal] = useState<"profile" | "password" | "appearance" | "recent" | "account" | null>(null);
  const [showThemeManager, setShowThemeManager] = useState(false);
  const [name, setName] = useState(authSession.user.name);
  const [email, setEmail] = useState(authSession.user.email);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState<"profile" | "password" | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [theme, setTheme] = useState<Theme>("light");
  const [density, setDensity] = useState<Density>("comfortable");
  const [fontSize, setFontSize] = useState<FontSize>("normal");
  const [recentProjectLimit, setRecentProjectLimit] = useState(10);
  const [recentProjects, setRecentProjects] = useState<PostgresExperimentRecentProject[]>([]);

  useEffect(() => {
    setName(authSession.user.name);
    setEmail(authSession.user.email);
  }, [authSession.user.email, authSession.user.name]);

  useEffect(() => {
    let cancelled = false;

    async function loadUserPreferences() {
      try {
        const [nextPreferences, projectState] = await Promise.all([
          getPostgresExperimentUserPreferences(),
          getPostgresExperimentUserProjectState(),
        ]);
        if (cancelled) return;
        setTheme(nextPreferences.theme);
        setDensity(nextPreferences.density);
        setFontSize(nextPreferences.fontSize);
        setRecentProjectLimit(nextPreferences.recentProjectLimit);
        setRecentProjects(projectState.recentProjects);
        if (nextPreferences.locale !== locale) {
          setLocale(nextPreferences.locale);
        }
        applyPostgresRuntimeThemePreferences(nextPreferences);
        setActivePresetId(null);
      } catch (loadError) {
        if (!cancelled) {
          setError(describeUnknownError(loadError));
        }
      }
    }

    void loadUserPreferences();
    return () => {
      cancelled = true;
    };
  }, [authSession.authKind, authSession.user.id]);

  const persistUserPreferences = useCallback(async (
    next: PostgresExperimentUserPreferences,
    successMessage?: string,
  ) => {
    const saved = await savePostgresExperimentUserPreferences(next);
    setTheme(saved.theme);
    setDensity(saved.density);
    setFontSize(saved.fontSize);
    setRecentProjectLimit(saved.recentProjectLimit);
    applyPostgresRuntimeThemePreferences(saved);
    if (successMessage) setNotice(successMessage);
    setError("");
  }, []);

  async function handleSaveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (authSession.authKind !== "app_user") {
      setError("The built-in local administrator account is managed through PostgreSQL setup, not this profile form.");
      return;
    }
    if (!name.trim() || !email.trim()) {
      setError("Enter your name and email.");
      return;
    }

    setSubmitting("profile");
    try {
      const previousEmail = authSession.user.email;
      const updatedUser = await updatePostgresExperimentAppUserProfile({
        name: name.trim(),
        email: email.trim(),
      });
      await renamePostgresExperimentRememberedAccount(previousEmail, updatedUser.email, updatedUser.name);
      onAuthSessionUpdated({
        ...authSession,
        user: updatedUser,
      });
      setNotice("Profile updated.");
      setActiveModal(null);
    } catch (updateError) {
      setError(describeUnknownError(updateError));
    } finally {
      setSubmitting(null);
    }
  }

  async function handleChangePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (authSession.authKind !== "app_user") {
      setError("The built-in local administrator password is managed through PostgreSQL setup, not this form.");
      return;
    }
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("Enter your current password and the new password twice.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Choose a password with at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }

    setSubmitting("password");
    try {
      const nextSession = await changePostgresExperimentAppUserPassword({
        currentPassword,
        newPassword,
      });
      onAuthSessionUpdated(nextSession);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNotice("Password changed.");
      setActiveModal(null);
    } catch (changeError) {
      setError(describeUnknownError(changeError));
    } finally {
      setSubmitting(null);
    }
  }

  function handleTheme(nextTheme: Theme) {
    setTheme(nextTheme);
    setActivePresetId(null);
    applyTheme(nextTheme);
    const nextPreferences: PostgresExperimentUserPreferences = {
      theme: nextTheme,
      density,
      fontSize,
      locale,
      recentProjectLimit,
      themeState: getStoredThemeState(),
    };
    void persistUserPreferences(nextPreferences);
  }

  function handleDensity(nextDensity: Density) {
    setDensity(nextDensity);
    applyDensity(nextDensity);
    const nextPreferences: PostgresExperimentUserPreferences = {
      theme,
      density: nextDensity,
      fontSize,
      locale,
      recentProjectLimit,
      themeState: getStoredThemeState(),
    };
    void persistUserPreferences(nextPreferences);
  }

  function handleFontSize(nextFontSize: FontSize) {
    setFontSize(nextFontSize);
    applyFontSize(nextFontSize);
    const nextPreferences: PostgresExperimentUserPreferences = {
      theme,
      density,
      fontSize: nextFontSize,
      locale,
      recentProjectLimit,
      themeState: getStoredThemeState(),
    };
    void persistUserPreferences(nextPreferences);
  }

  async function handleLocaleChange(nextLocale: (typeof SUPPORTED_LOCALES)[number]) {
    setLocale(nextLocale);
    const nextPreferences: PostgresExperimentUserPreferences = {
      theme,
      density,
      fontSize,
      locale: nextLocale,
      recentProjectLimit,
      themeState: getStoredThemeState(),
    };
    try {
      await persistUserPreferences(nextPreferences, "Language updated.");
    } catch (changeError) {
      setError(describeUnknownError(changeError));
    }
  }

  async function handleThemeManagerApplied() {
    const nextTheme = getStoredTheme();
    setTheme(nextTheme);
    setActivePresetId(null);
    await persistUserPreferences({
      theme: nextTheme,
      density,
      fontSize,
      locale,
      recentProjectLimit,
      themeState: getStoredThemeState(),
    }, "Theme updated.");
  }

  return (
    <div className="view user-settings-view">
      <header className="view-header">
        <div className="view-title-with-help">
          <h1>User Settings</h1>
        </div>
      </header>

      {notice ? <p className="settings-success">{notice}</p> : null}
      {error ? <p className="auth-error">{error}</p> : null}

      <div className="app-settings-overview-shell user-settings-overview-shell">
        <div className="app-settings-overview-stack">
          <div className="app-settings-overview-sections">
            <section className="app-settings-overview-section">
              <div className="app-settings-overview-section-header">
                <p className="app-settings-overview-section-heading">Account</p>
              </div>
              <div className="app-settings-overview-grid">
                <button
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--default"
                  onClick={() => setActiveModal(authSession.authKind === "app_user" ? "profile" : "account")}
                >
                  <h3>{authSession.authKind === "app_user" ? "Profile" : "Local Administrator"}</h3>
                  <p>
                    {authSession.authKind === "app_user"
                      ? "Update your PostgreSQL experiment display name and email."
                      : "Review the built-in PostgreSQL administrator account for this device."}
                  </p>
                </button>
                <button
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--admin"
                  onClick={() => setActiveModal(authSession.authKind === "app_user" ? "password" : "account")}
                >
                  <h3>Password</h3>
                  <p>
                    {authSession.authKind === "app_user"
                      ? "Change your PostgreSQL experiment account password."
                      : "Administrator password changes are handled through PostgreSQL setup."}
                  </p>
                </button>
              </div>
            </section>
            <section className="app-settings-overview-section">
              <div className="app-settings-overview-section-header">
                <p className="app-settings-overview-section-heading">Preferences</p>
              </div>
              <div className="app-settings-overview-grid">
                <button
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--default"
                  onClick={() => setActiveModal("appearance")}
                >
                  <h3>Appearance</h3>
                  <p>Adjust theme, density, and text size for this device.</p>
                </button>
                <button
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--default"
                  onClick={() => setActiveModal("recent")}
                >
                  <h3>Recent Projects</h3>
                  <p>Control how many recent projects are shown and clear the remembered list.</p>
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>

      {activeModal === "profile" ? (
        <div className="modal-overlay" onClick={() => submitting !== "profile" && setActiveModal(null)}>
          <div className="modal app-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">Profile</h2>
              </div>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>PostgreSQL App User</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <form className="form" onSubmit={handleSaveProfile}>
                      <label className="form-label">
                        Name
                        <input className="form-input" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
                      </label>
                      <label className="form-label">
                        Email
                        <input className="form-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
                      </label>
                      <div className="form-actions">
                        <button type="button" className="btn" onClick={() => setActiveModal(null)} disabled={submitting === "profile"}>
                          Cancel
                        </button>
                        <button type="submit" className="btn btn--primary" disabled={submitting === "profile" || !name.trim() || !email.trim()}>
                          {submitting === "profile" ? "Saving..." : "Save profile"}
                        </button>
                      </div>
                    </form>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === "password" ? (
        <div className="modal-overlay" onClick={() => submitting !== "password" && setActiveModal(null)}>
          <div className="modal app-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">Password</h2>
              </div>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Change Password</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <form className="form" onSubmit={handleChangePassword}>
                      <label className="form-label">
                        Current password
                        <input className="form-input" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoFocus />
                      </label>
                      <label className="form-label">
                        New password
                        <input className="form-input" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
                      </label>
                      <label className="form-label">
                        Confirm new password
                        <input className="form-input" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
                      </label>
                      <div className="form-actions">
                        <button type="button" className="btn" onClick={() => setActiveModal(null)} disabled={submitting === "password"}>
                          Cancel
                        </button>
                        <button type="submit" className="btn btn--primary" disabled={submitting === "password"}>
                          {submitting === "password" ? "Changing..." : "Change password"}
                        </button>
                      </div>
                    </form>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === "account" ? (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal app-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">Local Administrator</h2>
              </div>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Administrator Account</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="home-restricted-list">
                      <div className="home-restricted-item">
                        <span className="home-restricted-label">Name</span>
                        <span className="home-restricted-value">{authSession.user.name}</span>
                      </div>
                      <div className="home-restricted-item">
                        <span className="home-restricted-label">Email</span>
                        <span className="home-restricted-value">{authSession.user.email}</span>
                      </div>
                      <div className="home-restricted-item">
                        <span className="home-restricted-label">Role</span>
                        <span className="home-restricted-value">Local administrator</span>
                      </div>
                    </div>
                    <p className="auth-hint" style={{ marginTop: 16 }}>
                      This built-in account is the PostgreSQL superuser identity for the device. Its credentials are managed during PostgreSQL bootstrap and handoff rather than in this screen.
                    </p>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === "appearance" ? (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal modal--wide app-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">Appearance</h2>
              </div>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Interface</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <div className="settings-row-label">Theme</div>
                        <div className="settings-row-desc">Switch between light and dark mode.</div>
                      </div>
                      <div className="theme-options">
                        {(["light", "dark"] as Theme[]).map((option) => (
                          <button
                            key={option}
                            type="button"
                            className={`theme-option${theme === option ? " theme-option--active" : ""}`}
                            onClick={() => handleTheme(option)}
                          >
                            {option === "light" ? "Light" : "Dark"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <div className="settings-row-label">Interface density</div>
                        <div className="settings-row-desc">Choose a more spacious or compact layout.</div>
                      </div>
                      <div className="segmented-control">
                        {(["comfortable", "compact"] as Density[]).map((option) => (
                          <button
                            key={option}
                            type="button"
                            className={density === option ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                            onClick={() => handleDensity(option)}
                          >
                            {option === "comfortable" ? "Comfortable" : "Compact"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <div className="settings-row-label">Text size</div>
                        <div className="settings-row-desc">Adjust default interface text size.</div>
                      </div>
                      <div className="segmented-control">
                        {(["small", "normal", "large"] as FontSize[]).map((option) => (
                          <button
                            key={option}
                            type="button"
                            className={fontSize === option ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                            onClick={() => handleFontSize(option)}
                          >
                            {option === "small" ? "Small" : option === "normal" ? "Normal" : "Large"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <div className="settings-row-label">Language</div>
                        <div className="settings-row-desc">Choose the interface language for this account on this device.</div>
                      </div>
                      <select
                        className="form-input"
                        value={locale}
                        onChange={(event) => void handleLocaleChange(event.target.value as (typeof SUPPORTED_LOCALES)[number])}
                      >
                        {SUPPORTED_LOCALES.map((option) => (
                          <option key={option} value={option}>
                            {LOCALE_LABELS[option]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <div className="settings-row-label">Custom theme</div>
                        <div className="settings-row-desc">Edit saved presets, color overrides, corner radius, and border width for this device.</div>
                      </div>
                      <button type="button" className="btn" onClick={() => setShowThemeManager(true)}>
                        Edit theme
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === "recent" ? (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal modal--wide app-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">Recent Projects</h2>
              </div>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>History</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <div className="settings-row-label">Projects to show</div>
                        <div className="settings-row-desc">Limit how many remembered projects Kanqual surfaces in this account's recent history.</div>
                      </div>
                      <select
                        className="form-input"
                        value={recentProjectLimit}
                        onChange={(event) => {
                          const nextRecentProjectLimit = Number(event.target.value);
                          void persistUserPreferences({
                            theme,
                            density,
                            fontSize,
                            locale,
                            recentProjectLimit: nextRecentProjectLimit,
                            themeState: getStoredThemeState(),
                          }, "Recent project preferences saved.");
                        }}
                      >
                        {[5, 10, 15, 25].map((limit) => (
                          <option key={limit} value={limit}>
                            {limit}
                          </option>
                        ))}
                      </select>
                    </div>
                    {recentProjects.length === 0 ? (
                      <p className="auth-hint">No recent PostgreSQL experiment projects are currently remembered for this account.</p>
                    ) : (
                      <div className="users-table-wrap postgres-users-table-wrap" style={{ marginTop: 16, maxHeight: 280 }}>
                        <table className="users-table">
                          <thead>
                            <tr>
                              <th className="users-th">Project</th>
                              <th className="users-th">Description</th>
                              <th className="users-th">Opened</th>
                            </tr>
                          </thead>
                          <tbody>
                            {recentProjects.slice(0, recentProjectLimit).map((project) => (
                              <tr key={project.id} className="users-row">
                                <td className="users-td users-td--name">{project.name}</td>
                                <td className="users-td users-td--muted">{project.description || "-"}</td>
                                <td className="users-td users-td--muted">{formatPostgresExperimentDateTime(project.openedAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <div className="form-actions" style={{ marginTop: 16 }}>
                      <button
                        type="button"
                        className="btn"
                        disabled={recentProjects.length === 0}
                        onClick={() => {
                          void (async () => {
                            try {
                              await clearPostgresExperimentUserProjectState();
                              setRecentProjects([]);
                              setNotice("Recent PostgreSQL project history cleared.");
                              setError("");
                            } catch (clearError) {
                              setError(describeUnknownError(clearError));
                            }
                          })();
                        }}
                      >
                        Clear history
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showThemeManager ? (
        <ThemeManagerModal
          onClose={() => setShowThemeManager(false)}
          onApplied={() => void handleThemeManagerApplied()}
          onCanceled={() => {
            setTheme(getStoredTheme());
          }}
        />
      ) : null}
    </div>
  );
}

function ViewLoadingFallback() {
  const { t } = useI18n();

  return (
    <div className="view-loading-state" role="status" aria-live="polite">
      <div className="view-loading-card">
        <strong>{t("app.viewLoading.title")}</strong>
        <span>{t("app.viewLoading.detail")}</span>
      </div>
    </div>
  );
}

function SmokeTestAuthRunner() {
  const { status, user, pb, useLocalServer, register } = useAuth();
  const runStartedRef = useRef(false);
  const unmountedRef = useRef(false);
  const pbRef = useRef(pb);

  useEffect(() => {
    pbRef.current = pb;
  }, [pb]);

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  useEffect(() => {
    async function runSmokeAuthFlow() {
      const config = await getSmokeTestConfig();
      if (!config.enabled || runStartedRef.current || status === "loading" || user) return;

      const userName = config.userName?.trim();
      const userEmail = config.userEmail?.trim().toLowerCase();
      const userPassword = config.userPassword ?? "";
      if (!userName || !userEmail || !userPassword) {
        await updateSmokeTestState({
          phase: "failed",
          failure: "Smoke test is missing the temporary local account credentials.",
          success: false,
          appDataDir: config.appDataDir,
          portableMode: config.portableMode,
        });
        runStartedRef.current = true;
        return;
      }

      runStartedRef.current = true;

      try {
        await updateSmokeTestState({
          phase: "starting-local-workspace",
          message: "Launching the local PocketBase workspace.",
          success: false,
          appDataDir: config.appDataDir,
          portableMode: config.portableMode,
        });
        await useLocalServer();
        if (unmountedRef.current) {
          await updateSmokeTestState({
            phase: "runner-unmounted-after-local-start",
            message: "Smoke auth runner unmounted after local startup completed.",
            success: false,
            userEmail,
            appDataDir: config.appDataDir,
            portableMode: config.portableMode,
          });
          return;
        }

        await updateSmokeTestState({
          phase: "runner-after-local-start",
          message: "Smoke auth runner resumed after useLocalServer completed.",
          success: false,
          userEmail,
          appDataDir: config.appDataDir,
          portableMode: config.portableMode,
        });

        let waitIterations = 0;
        while (!pbRef.current && waitIterations < 40) {
          waitIterations += 1;
          await new Promise((resolve) => window.setTimeout(resolve, 100));
        }
        if (!pbRef.current) {
          throw new Error("Local workspace client did not become ready after startup.");
        }
        await updateSmokeTestState({
          phase: "runner-pb-ready-for-register",
          message: `Local workspace client became available after ${waitIterations * 100} ms.`,
          success: false,
          userEmail,
          appDataDir: config.appDataDir,
          portableMode: config.portableMode,
        });

        await updateSmokeTestState({
          phase: "registering-user",
          message: `Creating the first local account for ${userEmail}.`,
          success: false,
          userEmail,
          appDataDir: config.appDataDir,
          portableMode: config.portableMode,
        });
        await updateSmokeTestState({
          phase: "runner-before-register-call",
          message: `Calling register() for ${userEmail}.`,
          success: false,
          userEmail,
          appDataDir: config.appDataDir,
          portableMode: config.portableMode,
        });
        await register(userName, userEmail, userPassword);
        if (unmountedRef.current) {
          return;
        }
        await updateSmokeTestState({
          phase: "runner-register-complete",
          message: `register() completed for ${userEmail}.`,
          success: false,
          userEmail,
          appDataDir: config.appDataDir,
          portableMode: config.portableMode,
        });
      } catch (error) {
        if (unmountedRef.current) return;
        await updateSmokeTestState({
          phase: "failed",
          failure: describeUnknownError(error) || "Smoke auth flow failed.",
          success: false,
          userEmail,
          appDataDir: config.appDataDir,
          portableMode: config.portableMode,
        });
      }
    }

    void runSmokeAuthFlow();
  }, [pb, register, status, useLocalServer, user]);

  return null;
}

function SmokeTestStoreRunner() {
  const { projects, projectsLoading, activeProject, createProject, openProject } = useStore();
  const runStartedRef = useRef(false);
  const unmountedRef = useRef(false);

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  useEffect(() => {
    async function runSmokeProjectFlow() {
      const config = await getSmokeTestConfig();
      if (!config.enabled || runStartedRef.current || projectsLoading) return;

      const projectName = config.projectName?.trim();
      if (!projectName) {
        runStartedRef.current = true;
        await updateSmokeTestState({
          phase: "failed",
          failure: "Smoke test is missing the test project name.",
          success: false,
          userEmail: config.userEmail,
          appDataDir: config.appDataDir,
          portableMode: config.portableMode,
        });
        return;
      }

      if (activeProject?.name === projectName) {
        runStartedRef.current = true;
        await updateSmokeTestState({
          phase: "completed",
          message: `Opened smoke test project "${projectName}".`,
          success: true,
          projectId: activeProject.id,
          userEmail: config.userEmail,
          appDataDir: config.appDataDir,
          portableMode: config.portableMode,
        });
        return;
      }

      try {
        runStartedRef.current = true;
        await updateSmokeTestState({
          phase: "creating-project",
          message: `Creating smoke test project "${projectName}".`,
          success: false,
          userEmail: config.userEmail,
          appDataDir: config.appDataDir,
          portableMode: config.portableMode,
        });

        const existingProject = projects.find((project) => project.name.trim().toLowerCase() === projectName.toLowerCase());
        const project = existingProject ?? await createProject(projectName, "Packaged runtime smoke test project.");
        if (unmountedRef.current) return;

        await openProject(project, activeProject);
        if (unmountedRef.current) return;

        await updateSmokeTestState({
          phase: "completed",
          message: `Created and opened smoke test project "${project.name}".`,
          success: true,
          projectId: project.id,
          userEmail: config.userEmail,
          appDataDir: config.appDataDir,
          portableMode: config.portableMode,
        });
      } catch (error) {
        if (unmountedRef.current) return;
        await updateSmokeTestState({
          phase: "failed",
          failure: describeUnknownError(error) || "Smoke project flow failed.",
          success: false,
          userEmail: config.userEmail,
          appDataDir: config.appDataDir,
          portableMode: config.portableMode,
        });
      }
    }

    void runSmokeProjectFlow();
  }, [activeProject, createProject, openProject, projects, projectsLoading]);

  return null;
}

function AppShell() {
  const { view } = useStore();
  const ActiveView = VIEW_COMPONENTS[view as keyof typeof VIEW_COMPONENTS];
  const [availableUpdate, setAvailableUpdate] = useState<ReleaseCheckResult | null>(null);

  useEffect(() => { initTheme(); }, []);
  useAutomaticProjectBackups();

  useEffect(() => {
    function allowNativeContextMenu(target: EventTarget | null): boolean {
      if (!(target instanceof Element)) return false;

      const editableAncestor = target.closest(
        [
          "input",
          "textarea",
          "select",
          "[contenteditable=\"true\"]",
          "[contenteditable=\"\"]",
          "[role=\"textbox\"]",
        ].join(","),
      );

      if (!editableAncestor) return false;
      if (editableAncestor instanceof HTMLInputElement) {
        return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(
          editableAncestor.type,
        );
      }

      return true;
    }

    function handleContextMenu(event: MouseEvent) {
      if (allowNativeContextMenu(event.target)) return;
      event.preventDefault();
    }

    window.addEventListener("contextmenu", handleContextMenu);
    return () => {
      window.removeEventListener("contextmenu", handleContextMenu);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function checkForAppUpdates() {
      try {
        const [installationSettings, deviceState] = await Promise.all([
          getPostgresExperimentInstallationSettings(),
          getPostgresExperimentDeviceState(),
        ]);
        if (!installationSettings.updatesAutoCheck) return;
        const runtimeInfo = await getAppRuntimeInfo();
        const update = await fetchLatestRelease();
        if (!update) return;
        if (compareSemver(update.latestVersion, runtimeInfo.appVersion) <= 0) return;
        const dismissedVersion = deviceState.dismissedUpdateVersion;
        if (dismissedVersion === update.latestVersion) return;
        if (!cancelled) setAvailableUpdate(update);
      } catch (error) {
        console.warn("Update check failed:", describeUnknownError(error));
      }
    }

    void checkForAppUpdates();
    return () => {
      cancelled = true;
    };
  }, []);

  async function dismissAvailableUpdate() {
    if (availableUpdate) {
      try {
        await savePostgresExperimentDeviceState({
          dismissedUpdateVersion: availableUpdate.latestVersion,
        });
      } catch (error) {
        console.warn("Could not persist dismissed update version:", describeUnknownError(error));
      }
    }
    setAvailableUpdate(null);
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        {availableUpdate && (
          <UpdateAvailableBanner
            version={availableUpdate.latestVersion}
            releaseUrl={availableUpdate.releaseUrl}
            onDismiss={dismissAvailableUpdate}
          />
        )}
        <ProjectBackupBanner />
        <ProjectEmbeddingBuildBanner />
        <DocumentProcessingBanner />
        <EmbeddingModelDownloadBanner />
        {ActiveView && (
          <Suspense fallback={<ViewLoadingFallback />}>
            <ActiveView />
          </Suspense>
        )}
      </main>
    </div>
  );
}

function AuthGate() {
  const { status, pb, user } = useAuth();
  const [postgresStatus, setPostgresStatus] = useState<PostgresExperimentStatus | null>(null);
  const [postgresStatusLoaded, setPostgresStatusLoaded] = useState(false);
  const [postgresAuthStatus, setPostgresAuthStatus] = useState<PostgresExperimentAuthStatus | null>(null);
  const [postgresAuthLoaded, setPostgresAuthLoaded] = useState(false);
  const [postgresInstallationSettings, setPostgresInstallationSettings] = useState<PostgresExperimentInstallationSettings | null>(null);
  const [postgresLaunchScreenDismissed, setPostgresLaunchScreenDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadPostgresRuntimePreferences() {
      if (!postgresAuthStatus?.currentSession) return;
      try {
        const preferences = await getPostgresExperimentUserPreferences();
        if (!cancelled) {
          applyPostgresRuntimeThemePreferences(preferences);
        }
      } catch (error) {
        console.warn("Could not load PostgreSQL runtime theme preferences:", describeUnknownError(error));
      }
    }

    void loadPostgresRuntimePreferences();
    return () => {
      cancelled = true;
    };
  }, [postgresAuthStatus?.currentSession?.authKind, postgresAuthStatus?.currentSession?.user.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadPostgresExperimentState() {
      try {
        const nextStatus = await getPostgresExperimentStatus();
        if (cancelled) return;

        setPostgresStatus(nextStatus);
        const nextInstallationSettings = nextStatus.bootstrapApplied
          ? await getPostgresExperimentInstallationSettings()
          : null;
        if (!cancelled) {
          setPostgresInstallationSettings(nextInstallationSettings);
          if (nextInstallationSettings) {
            syncLegacyAppSettingsFromPostgresInstallationSettings(nextInstallationSettings);
          }
        }
        if (nextStatus.bootstrapApplied && nextStatus.adminHandoffCompleted) {
          const shouldRememberSession = shouldRememberPostgresSession(nextInstallationSettings);
          let nextAuthStatus = await getPostgresExperimentAuthStatus();
          if (!shouldRememberSession && nextAuthStatus.currentSession) {
            nextAuthStatus = await logoutPostgresExperimentAppUser();
          }
          if (!cancelled) {
            setPostgresAuthStatus(nextAuthStatus);
          }
        } else if (!cancelled) {
          setPostgresAuthStatus(null);
        }
      } catch (error) {
        console.warn("Failed to load PostgreSQL experiment status:", describeUnknownError(error));
        if (!cancelled) {
          setPostgresAuthStatus(null);
          setPostgresInstallationSettings(null);
        }
      } finally {
        if (!cancelled) {
          setPostgresStatusLoaded(true);
          setPostgresAuthLoaded(true);
        }
      }
    }

    void loadPostgresExperimentState();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshPostgresStatus() {
    setPostgresStatusLoaded(false);
    setPostgresAuthLoaded(false);
    try {
      const nextStatus = await getPostgresExperimentStatus();
      setPostgresStatus(nextStatus);
      const nextInstallationSettings = nextStatus.bootstrapApplied
        ? await getPostgresExperimentInstallationSettings()
        : null;
      setPostgresInstallationSettings(nextInstallationSettings);
      if (nextInstallationSettings) {
        syncLegacyAppSettingsFromPostgresInstallationSettings(nextInstallationSettings);
      }
      if (nextStatus.bootstrapApplied && nextStatus.adminHandoffCompleted) {
        const shouldRememberSession = shouldRememberPostgresSession(nextInstallationSettings);
        let nextAuthStatus = await getPostgresExperimentAuthStatus();
        if (!shouldRememberSession && nextAuthStatus.currentSession) {
          nextAuthStatus = await logoutPostgresExperimentAppUser();
        }
        setPostgresAuthStatus(nextAuthStatus);
      } else {
        setPostgresAuthStatus(null);
      }
    } catch (error) {
      console.warn("Failed to refresh PostgreSQL experiment status:", describeUnknownError(error));
    } finally {
      setPostgresStatusLoaded(true);
      setPostgresAuthLoaded(true);
    }
  }

  async function handleBootstrapPostgresExperiment(superuserPassword: string) {
    await bootstrapPostgresExperiment(superuserPassword);
    await refreshPostgresStatus();
  }

  const requiresPostgresAdminHandoff = !!(
    postgresStatusLoaded
    && postgresStatus
    && postgresStatus.bootstrapApplied
    && !postgresStatus.adminHandoffCompleted
  );
  const postgresAuthReady = !!(
    postgresStatusLoaded
    && postgresStatus
    && postgresStatus.bootstrapApplied
    && postgresStatus.adminHandoffCompleted
  );

  if (!postgresLaunchScreenDismissed) {
    if (requiresPostgresAdminHandoff && postgresStatus) {
      return (
        <PostgresAdminHandoffView
          status={postgresStatus}
          onComplete={async (nextStatus) => {
            setPostgresStatus(nextStatus);
            await refreshPostgresStatus();
          }}
        />
      );
    }

    if (!postgresStatusLoaded || (postgresAuthReady && !postgresAuthLoaded)) {
      return (
        <div className="auth-screen">
          <div className="auth-card auth-card--startup">
            <div className="auth-brand">Kanqual</div>
            <p className="auth-tagline">PostgreSQL Experiment</p>
            <p className="auth-starting">
              {postgresAuthReady
                ? "Checking PostgreSQL sign-in status..."
                : "Checking local PostgreSQL experiment status..."}
            </p>
          </div>
        </div>
      );
    }

    if (postgresAuthReady && postgresAuthStatus?.currentSession) {
      return (
        <PostgresProjectsExperimentView
          authSession={postgresAuthStatus.currentSession}
          onAuthSessionUpdated={(session) => {
            setPostgresAuthStatus((current) => current
              ? {
                  ...current,
                  currentSession: session,
                }
              : {
                  bootstrapApplied: true,
                  adminHandoffCompleted: true,
                  ready: true,
                  registeredUserCount: 0,
                  localAdminName: "postgres",
                  requiresAccountSetup: false,
                  currentSession: session,
                });
          }}
          onBack={() => undefined}
          onSignOut={async () => {
            const nextAuthStatus = await logoutPostgresExperimentAppUser();
            if (postgresInstallationSettings?.privacyForgetLoginIdentitiesOnLogout) {
              await clearPostgresExperimentRememberedAccounts();
            }
            if (postgresInstallationSettings?.privacyClearRecentProjectsOnSignOut) {
              await clearPostgresExperimentUserProjectState();
            }
            setPostgresAuthStatus(nextAuthStatus);
          }}
          onOpenCurrentApp={() => setPostgresLaunchScreenDismissed(true)}
        />
      );
    }

    if (postgresAuthReady) {
      return (
        <PostgresExperimentAuthView
          authStatus={postgresAuthStatus}
          onRefresh={refreshPostgresStatus}
          onAuthenticated={(session) => {
            setPostgresAuthStatus((current) => current
              ? {
                  ...current,
                  currentSession: session,
                  requiresAccountSetup: false,
                }
              : {
                  bootstrapApplied: true,
                  adminHandoffCompleted: true,
                  ready: true,
                  registeredUserCount: 0,
                  localAdminName: "postgres",
                  requiresAccountSetup: false,
                  currentSession: session,
                });
          }}
          onOpenCurrentApp={() => setPostgresLaunchScreenDismissed(true)}
        />
      );
    }

    return (
      <PostgresExperimentLaunchView
        status={postgresStatus}
        loading={!postgresStatusLoaded}
        onRefresh={() => {
          void refreshPostgresStatus();
        }}
        onBootstrap={handleBootstrapPostgresExperiment}
        onOpenPostgresProjects={() => {
          void refreshPostgresStatus();
        }}
        onOpenCurrentApp={() => setPostgresLaunchScreenDismissed(true)}
      />
    );
  }

  if (requiresPostgresAdminHandoff && postgresStatus) {
    return (
      <PostgresAdminHandoffView
        status={postgresStatus}
        onComplete={async (nextStatus) => {
          setPostgresStatus(nextStatus);
          await refreshPostgresStatus();
        }}
      />
    );
  }

  if (status !== "authenticated" || !pb) {
    return (
      <>
        <SmokeTestAuthRunner />
        <AuthView />
      </>
    );
  }

  if (user?.must_change_password) {
    return <ForcePasswordChangeView />;
  }

  return (
    <StoreProvider pb={pb}>
      <SmokeTestStoreRunner />
      <AppShell />
    </StoreProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <I18nProvider>
        <AppErrorBoundaryWithI18n>
          <AuthGate />
        </AppErrorBoundaryWithI18n>
      </I18nProvider>
    </AuthProvider>
  );
}

