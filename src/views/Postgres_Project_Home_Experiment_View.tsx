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
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
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
import sourceImageOutlineShapeSvg from "../assets/object-shapes/source-image-outline.svg?raw";
import sourceAudioOutlineShapeSvg from "../assets/object-shapes/source-audio-outline.svg?raw";
import sourceVideoOutlineShapeSvg from "../assets/object-shapes/source-video-outline.svg?raw";
import { formatCurrentDateTime } from "../i18n/formatters";
import {
  createPostgresExperimentProjectUser,
  createPostgresExperimentRelationshipAttributeDefinition,
  deletePostgresExperimentObject,
  deletePostgresExperimentObjectType,
  deletePostgresExperimentProjectUser,
  deletePostgresExperimentRelationship,
  deletePostgresExperimentRelationshipType,
  deletePostgresExperimentSavedDrawing,
  getPostgresExperimentProjectCanvasState,
  getPostgresExperimentSavedDrawing,
  listPostgresExperimentAppUsers,
  listPostgresExperimentObjects,
  listPostgresExperimentObjectAttributeDefinitions,
  listPostgresExperimentObjectTypes,
  listPostgresExperimentProjectUsers,
  listPostgresExperimentRelationshipAttributeDefinitions,
  listPostgresExperimentRelationships,
  listPostgresExperimentRelationshipTypes,
  listPostgresExperimentSavedDrawingSummaries,
  savePostgresExperimentObject,
  savePostgresExperimentObjectType,
  savePostgresExperimentProjectCanvasState,
  savePostgresExperimentRelationship,
  savePostgresExperimentRelationshipType,
  savePostgresExperimentSavedDrawing,
  updatePostgresExperimentProjectUser,
  updatePostgresExperimentRelationshipAttributeDefinition,
  type PostgresExperimentAppUser,
  type PostgresExperimentAuthSession,
  type PostgresExperimentCanvasDisplayShape,
  type PostgresExperimentCanvasNodeState,
  type PostgresExperimentCanvasPoint,
  type PostgresExperimentCanvasShape,
  type PostgresExperimentObject,
  type PostgresExperimentObjectAttributeDefinition,
  type PostgresExperimentObjectType,
  type PostgresExperimentProject,
  type PostgresExperimentProjectChangeEvent,
  type PostgresExperimentProjectUser,
  type PostgresExperimentRelationship,
  type PostgresExperimentRelationshipAttributeDefinition,
  type PostgresExperimentRelationshipType,
  type PostgresExperimentSavedDrawing,
  type PostgresExperimentSavedDrawingSummary,
  POSTGRES_PROJECT_CHANGED_EVENT,
} from "../lib/postgresExperiment";
import {
  AttributeValuesModal,
  type SharedAttributeDraft,
} from "../components/AttributeValuesModal";
import { AttributeDefinitionModal } from "../components/AttributeDefinitionModal";
import sidebarLogo from "../assets/logo-no-background.png";

function normalizeCanvasSvgTextHtml(html: string): string {
  const trimmed = html.trim();
  return trimmed ? html : "<div>Text</div>";
}

const PostgresAppSettingsExperimentViewLazy = lazy(
  () => import("./Postgres_App_Settings_Experiment_View").then((m) => ({ default: m.PostgresAppSettingsExperimentView })),
);
const PostgresUserSettingsExperimentViewLazy = lazy(
  () => import("./Postgres_User_Settings_Experiment_View").then((m) => ({ default: m.PostgresUserSettingsExperimentView })),
);
const PostgresProjectSettingsExperimentViewLazy = lazy(
  () => import("./Postgres_Project_Settings_Experiment_View").then((m) => ({ default: m.PostgresProjectSettingsExperimentView })),
);
const PostgresProjectSourcesViewLazy = lazy(
  () => import("./Postgres_Project_Sources_View").then((m) => ({ default: m.PostgresProjectSourcesView })),
);
const PostgresAnalysisCodeSourcesViewLazy = lazy(
  () => import("./Postgres_Analysis_Code_Sources_View").then((m) => ({ default: m.PostgresAnalysisCodeSourcesView })),
);
const PostgresFreeDrawCanvasViewLazy = lazy(
  () => import("./Postgres_Free_Draw_Canvas_View").then((m) => ({ default: m.PostgresExperimentCanvasView })),
);
const PostgresExploreCanvasViewLazy = lazy(
  () => import("./Postgres_Explore_Canvas_View").then((m) => ({ default: m.PostgresExperimentExploreCanvasView })),
);
const PostgresMemosViewLazy = lazy(
  () => import("./Postgres_Memos_View").then((m) => ({ default: m.PostgresMemosView })),
);
const PostgresProjectLogViewLazy = lazy(
  () => import("./Postgres_Project_Log_View").then((m) => ({ default: m.PostgresProjectLogView })),
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

export type PostgresProjectHomeExperimentViewProps = {
  project: PostgresExperimentProject;
  authSession: PostgresExperimentAuthSession;
  onAuthSessionUpdated: (session: PostgresExperimentAuthSession) => void;
  onAuthSessionInvalidated: () => void;
  onBack: () => void;
  onProjectUpdated: (project: PostgresExperimentProject) => void;
  onProjectDeleted: (projectId: string) => void;
  onSignOut: () => Promise<void>;
};

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

const POSTGRES_OBJECT_TYPE_DEFAULT_COLOR = "#355070";
const POSTGRES_RELATIONSHIP_DEFAULT_COLOR = "#355070";
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

function renderCanvasTextForeignObjectSvg(
  shape: Extract<PostgresExperimentCanvasShape, { kind: "text" }>,
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
} */

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

export function PostgresProjectHomeExperimentView({
  project,
  authSession,
  onAuthSessionUpdated,
  onAuthSessionInvalidated,
  onBack,
  onProjectUpdated,
  onProjectDeleted,
  onSignOut,
}: PostgresProjectHomeExperimentViewProps) {
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
                onOpenCreateObjectType={() => setCreateObjectTypeOpen(true)}
                onOpenCreateRelationshipType={() => setCreateRelationshipTypeOpen(true)}
                onEditObject={openEditObjectModal}
                onDeleteObject={(objectId) => setRemovingObjectId(objectId)}
                onEditRelationship={openEditRelationshipModal}
                onDeleteRelationship={(relationshipId) => setRemovingRelationshipId(relationshipId)}
                ObjectShapeSwatchComponent={ObjectShapeSwatch}
                getPostgresExperimentObjectAppearance={getPostgresExperimentObjectAppearance}
                getPostgresExperimentObjectSurfaceStyle={getPostgresExperimentObjectSurfaceStyle}
                getCanvasNodeDefaultDimensions={getCanvasNodeDefaultDimensions}
                getCanvasNodeRenderedDimensions={getCanvasNodeRenderedDimensions}
                getPostgresExperimentRelationshipAppearance={getPostgresExperimentRelationshipAppearance}
                getPostgresExperimentRelationshipStrokeWidth={getPostgresExperimentRelationshipStrokeWidth}
                normalizePostgresExperimentObjectTypeColor={normalizePostgresExperimentObjectTypeColor}
                normalizePostgresExperimentRelationshipLineShape={normalizePostgresExperimentRelationshipLineShape}
                normalizePostgresExperimentObjectTypeShape={normalizePostgresExperimentObjectTypeShape}
                normalizePostgresExperimentObjectFill={normalizePostgresExperimentObjectFill}
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
                getPostgresExperimentRelationshipStrokeDasharray={getPostgresExperimentRelationshipStrokeDasharray}
                formatPostgresExperimentObjectShapeLabel={formatPostgresExperimentObjectShapeLabel}
                formatPostgresExperimentObjectFillLabel={formatPostgresExperimentObjectFillLabel}
                formatPostgresExperimentRelationshipLineShapeLabel={formatPostgresExperimentRelationshipLineShapeLabel}
                formatPostgresExperimentRelationshipLineWeightLabel={formatPostgresExperimentRelationshipLineWeightLabel}
                formatPostgresExperimentRelationshipArrowheadLabel={formatPostgresExperimentRelationshipArrowheadLabel}
                formatCanvasSketchShapeLabel={formatCanvasSketchShapeLabel}
                postgreRelationshipLineShapePickerComponent={PostgresExperimentRelationshipLineShapePicker}
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
                getObjectAppearance={getPostgresExperimentObjectAppearance}
                getObjectSurfaceStyle={getPostgresExperimentObjectSurfaceStyle}
                getRelationshipAppearance={getPostgresExperimentRelationshipAppearance}
                getRelationshipStrokeWidth={getPostgresExperimentRelationshipStrokeWidth}
                getNodeDefaultDimensions={(object, objectTypeRecord) => {
                  const shape = getPostgresExperimentObjectAppearance(object, objectTypeRecord).shape;
                  return getCanvasNodeDefaultDimensions(shape);
                }}
                getNodeRenderedDimensions={(object, objectTypeRecord, nodeState) => {
                  const shape = getPostgresExperimentObjectAppearance(object, objectTypeRecord).shape;
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
              <PostgresAppSettingsExperimentViewLazy authSession={authSession} />
            </Suspense>
          ) : activeScreen === "project-settings" ? (
            <Suspense fallback={<ViewLoadingFallback />}>
              <PostgresProjectSettingsExperimentViewLazy
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
              <PostgresUserSettingsExperimentViewLazy
                authSession={authSession}
                onAuthSessionUpdated={onAuthSessionUpdated}
                onAuthSessionInvalidated={onAuthSessionInvalidated}
              />
            </Suspense>
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
