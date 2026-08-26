import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import "vis-timeline/styles/vis-timeline-graph2d.min.css";
import type { TimelineGroup, TimelineItem } from "vis-timeline";
import sourceTextOutlineShapeSvg from "../assets/object-shapes/source-text-outline.svg?raw";
import sourceProcessedTranscriptOutlineShapeSvg from "../assets/object-shapes/source-processed-transcript-outline.svg?raw";
import sourcePdfOutlineShapeSvg from "../assets/object-shapes/source-pdf-outline.svg?raw";
import sourceImageOutlineShapeSvg from "../assets/object-shapes/source-image-outline.svg?raw";
import sourceAudioOutlineShapeSvg from "../assets/object-shapes/source-audio-outline.svg?raw";
import sourceVideoOutlineShapeSvg from "../assets/object-shapes/source-video-outline.svg?raw";
import { CollaborationIcon, ObjectIcon, PlusIcon, RelationshipIcon, SourceIcon } from "../components/AppIcons";
import { SettingsModal } from "../components/SettingsModal";
import type {
  PostgresObject,
  PostgresObjectAttributeDefinition,
  PostgresObjectType,
  PostgresRelationship,
  PostgresRelationshipAttributeDefinition,
  PostgresRelationshipType,
  PostgresSource,
  PostgresSourceAttributeDefinition,
  PostgresSourceTypeSetting,
  PostgresSourceAttributeValue,
  PostgresTimelineAttributeRole,
  PostgresTimelineGroup,
  PostgresTimelineGroupRowOrder,
  PostgresTimelineItemGroupAssignment,
} from "../lib/postgres";

type PostgresProjectTimelineItemKind = "source" | "object" | "relationship";

type PostgresProjectTimelineEntry = {
  id: string;
  itemKind: PostgresProjectTimelineItemKind;
  itemId: string;
  kind: PostgresProjectTimelineItemKind;
  title: string;
  typeLabel: string;
  itemType: string;
  groupId: string;
  groupLabel: string;
  groupKind: PostgresProjectTimelineItemKind | "custom";
  start: Date;
  end: Date | null;
  fillColor: string;
  outlineColor: string;
  group: PostgresTimelineGroup | null;
  visualFillColor?: string;
  visualOutlineColor?: string;
  visualShape?: TimelineObjectShape;
  visualFill?: "filled" | "outline";
  sourceVisualKey?: TimelineSourceVisualKey | null;
  lineShape?: TimelineRelationshipLineShape;
  lineWeight?: number;
  arrowhead?: TimelineRelationshipArrowhead;
};

const TIMELINE_SOURCE_DEFAULT_FILL = "#e0f2f1";
const TIMELINE_SOURCE_DEFAULT_OUTLINE = "#0f766e";
const TIMELINE_OBJECT_DEFAULT_FILL = "#e8edf3";
const TIMELINE_OBJECT_DEFAULT_OUTLINE = "#355070";
const TIMELINE_RELATIONSHIP_DEFAULT_FILL = "#ede9fe";
const TIMELINE_RELATIONSHIP_DEFAULT_OUTLINE = "#7c3aed";
const TIMELINE_DEFAULT_GROUP_COLOR = "#355070";
const TIMELINE_DEFAULT_GROUP_BACKGROUND = "#e8edf3";
const TIMELINE_UNASSIGNED_GROUP_ID = "default:unassigned";
const TIMELINE_UNASSIGNED_GROUP_LABEL = "Unassigned";
const TIMELINE_APPEARANCE_STORAGE_KEY = "kanqual_project_home_timeline_appearance";
const TIMELINE_GROUP_FILL_OPTIONS = [
  { value: "filled", label: "Filled" },
  { value: "outline", label: "Outline" },
];
const TIMELINE_GROUP_TEXT_SIZE_OPTIONS = [
  { value: "small", label: "Small" },
  { value: "regular", label: "Regular" },
  { value: "large", label: "Large" },
];
const TIMELINE_GROUP_TEXT_SIZE_ORDER = ["small", "regular", "large"];
type TimelineAppearanceSettings = {
  backgroundColor: string;
  lineColor: string;
  fontSize: "small" | "regular" | "large";
  rowHeight: number;
};
const DEFAULT_TIMELINE_APPEARANCE: TimelineAppearanceSettings = {
  backgroundColor: "#ffffff",
  lineColor: "#dce6ef",
  fontSize: "regular",
  rowHeight: 54,
};
type TimelineSourceVisualKey =
  | "source_text"
  | "source_processed_transcript"
  | "source_pdf"
  | "source_image"
  | "source_audio"
  | "source_video";
type TimelineObjectShape =
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
type TimelineRelationshipLineShape =
  | "solid"
  | "dashed"
  | "long_dashed"
  | "short_dashed"
  | "dotted"
  | "loose_dotted"
  | "dash_dot"
  | "dash_dot_dot";
type TimelineRelationshipArrowhead = "one_sided" | "double_sided" | "none";

function buildTimelineSvgDataUrl(svgMarkup: string): string {
  const normalizedMarkup = svgMarkup.replace("<svg ", '<svg width="100" height="100" ');
  return `data:image/svg+xml;utf8,${encodeURIComponent(normalizedMarkup)}`;
}

const TIMELINE_SOURCE_VISUALS: Record<TimelineSourceVisualKey, string> = {
  source_text: buildTimelineSvgDataUrl(sourceTextOutlineShapeSvg),
  source_processed_transcript: buildTimelineSvgDataUrl(sourceProcessedTranscriptOutlineShapeSvg),
  source_pdf: buildTimelineSvgDataUrl(sourcePdfOutlineShapeSvg),
  source_image: buildTimelineSvgDataUrl(sourceImageOutlineShapeSvg),
  source_audio: buildTimelineSvgDataUrl(sourceAudioOutlineShapeSvg),
  source_video: buildTimelineSvgDataUrl(sourceVideoOutlineShapeSvg),
};

function timelineSourceVisualKey(sourceKind: string | null | undefined): TimelineSourceVisualKey {
  const normalized = normalizeTimelineSourceKind(sourceKind);
  if (normalized === "transcript" || normalized === "processed_transcript") return "source_processed_transcript";
  if (normalized === "pdf") return "source_pdf";
  if (normalized === "image") return "source_image";
  if (normalized === "audio") return "source_audio";
  if (normalized === "video") return "source_video";
  return "source_text";
}

function normalizeTimelineObjectShape(value: string | null | undefined): TimelineObjectShape {
  const normalized = (value ?? "").trim().toLowerCase();
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
  ) return normalized;
  return "rounded";
}

function normalizeTimelineObjectFill(value: string | null | undefined): "filled" | "outline" {
  return (value ?? "").trim().toLowerCase() === "outline" ? "outline" : "filled";
}

function normalizeTimelineRelationshipLineShape(value: string | null | undefined): TimelineRelationshipLineShape {
  const normalized = (value ?? "").trim().toLowerCase();
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

function normalizeTimelineRelationshipLineWeight(value: number | null | undefined): number {
  if (value === 1 || value === 3 || value === 4) return value;
  return 2;
}

function normalizeTimelineRelationshipArrowhead(value: string | null | undefined): TimelineRelationshipArrowhead {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "double_sided" || normalized === "none") return normalized;
  return "one_sided";
}

function formatPostgresSourceKindLabel(kind: string): string {
  return kind ? kind.split(/[_\s-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") : "Source";
}

function formatTimelineInspectorDate(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function normalizeTimelineColor(value: string | null | undefined, fallback: string): string {
  const normalized = (value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : fallback;
}

function translucentTimelineFill(hexColor: string, alphaHex = "24"): string {
  return /^#[0-9a-f]{6}$/i.test(hexColor) ? `${hexColor}${alphaHex}` : hexColor;
}

function timelineAlphaHexFromPercent(percent: number): string {
  const normalized = Math.max(0, Math.min(100, Math.round(percent)));
  return Math.round((normalized / 100) * 255)
    .toString(16)
    .padStart(2, "0");
}

function normalizeTimelinePercent(value: number | null | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value as number))) : fallback;
}

function timelineBackgroundTransparencyFromFill(value: string | null | undefined): number {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized.startsWith("transparency:")) {
    const parsed = Number.parseInt(normalized.slice("transparency:".length), 10);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : 87;
  }
  if (normalized.startsWith("opacity:")) {
    const parsed = Number.parseInt(normalized.slice("opacity:".length), 10);
    return Number.isFinite(parsed) ? 100 - Math.max(0, Math.min(100, parsed)) : 87;
  }
  if (normalized === "solid") return 0;
  if (normalized === "none" || normalized === "transparent") return 100;
  return 87;
}

function normalizeTimelineSourceKind(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function resolveSourceTimelineColors(sourceKind: string, sourceTypeSettings: PostgresSourceTypeSetting[]) {
  const sourceType = sourceTypeSettings.find(
    (setting) => normalizeTimelineSourceKind(setting.sourceKind) === normalizeTimelineSourceKind(sourceKind),
  );
  const fillColor = normalizeTimelineColor(sourceType?.color, TIMELINE_SOURCE_DEFAULT_FILL);
  const outlineColor = normalizeTimelineColor(sourceType?.outlineColor || sourceType?.color, TIMELINE_SOURCE_DEFAULT_OUTLINE);
  return {
    fillColor: sourceType?.fill === "outline" ? "transparent" : translucentTimelineFill(fillColor),
    outlineColor,
  };
}

function resolveObjectTimelineColors(object: PostgresObject, objectType: PostgresObjectType | null) {
  const fillBase = normalizeTimelineColor(object.colorOverride || objectType?.color, TIMELINE_OBJECT_DEFAULT_FILL);
  const outlineBase = normalizeTimelineColor(
    object.outlineColorOverride || object.colorOverride || objectType?.outlineColor || objectType?.color,
    TIMELINE_OBJECT_DEFAULT_OUTLINE,
  );
  return {
    fillColor: (object.fillOverride || objectType?.fill) === "outline" ? "transparent" : translucentTimelineFill(fillBase),
    outlineColor: outlineBase,
    visualFillColor: fillBase,
    visualOutlineColor: outlineBase,
  };
}

function resolveRelationshipTimelineColors(relationship: PostgresRelationship, relationshipType: PostgresRelationshipType | null) {
  const rawColor = relationship.colorOverride || relationshipType?.color;
  const color = normalizeTimelineColor(rawColor, TIMELINE_RELATIONSHIP_DEFAULT_OUTLINE);
  return {
    fillColor: rawColor ? translucentTimelineFill(color) : TIMELINE_RELATIONSHIP_DEFAULT_FILL,
    outlineColor: color,
  };
}

function normalizeTimelineGroupOption(value: string | null | undefined, allowed: string[], fallback: string): string {
  const normalized = (value ?? "").trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function loadTimelineAppearanceSettings(): TimelineAppearanceSettings {
  if (typeof window === "undefined") return DEFAULT_TIMELINE_APPEARANCE;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TIMELINE_APPEARANCE_STORAGE_KEY) ?? "{}") as Partial<TimelineAppearanceSettings>;
    return {
      backgroundColor: normalizeTimelineColor(parsed.backgroundColor, DEFAULT_TIMELINE_APPEARANCE.backgroundColor),
      lineColor: normalizeTimelineColor(parsed.lineColor, DEFAULT_TIMELINE_APPEARANCE.lineColor),
      fontSize: normalizeTimelineGroupOption(
        parsed.fontSize,
        TIMELINE_GROUP_TEXT_SIZE_OPTIONS.map((option) => option.value),
        DEFAULT_TIMELINE_APPEARANCE.fontSize,
      ) as TimelineAppearanceSettings["fontSize"],
      rowHeight: Math.max(40, Math.min(86, Number(parsed.rowHeight) || DEFAULT_TIMELINE_APPEARANCE.rowHeight)),
    };
  } catch {
    return DEFAULT_TIMELINE_APPEARANCE;
  }
}

function saveTimelineAppearanceSettings(settings: TimelineAppearanceSettings): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TIMELINE_APPEARANCE_STORAGE_KEY, JSON.stringify(settings));
}

function timelineItemStyle(fillColor: string, outlineColor: string, group: PostgresTimelineGroup | null = null): string {
  if (!group) {
    return `--timeline-event-fill: ${fillColor}; --timeline-event-outline: ${outlineColor}; background-color: ${fillColor}; border-color: ${outlineColor};`;
  }
  const groupColor = normalizeTimelineColor(group.color, fillColor);
  const groupOutlineColor = normalizeTimelineColor(group.outlineColor || group.color, outlineColor);
  const fillMode = normalizeTimelineGroupOption(group.itemFill, ["filled", "outline"], "filled");
  const fillTransparency = normalizeTimelinePercent(group.itemFillTransparency, 86);
  const fillOpacity = 100 - fillTransparency;
  const itemFillColor = fillMode === "outline" || fillOpacity <= 0 ? "transparent" : translucentTimelineFill(groupColor, timelineAlphaHexFromPercent(fillOpacity));
  return `--timeline-event-fill: ${itemFillColor}; --timeline-event-outline: ${groupOutlineColor}; background-color: ${itemFillColor}; border-color: ${groupOutlineColor};`;
}

function timelineItemClassName(entry: PostgresProjectTimelineEntry): string {
  const durationClass = entry.end ? "project-timeline-item--range" : "project-timeline-item--point";
  if (!entry.group) return `project-timeline-item project-timeline-item--${entry.kind} ${durationClass}`;
  const textSize = normalizeTimelineGroupOption(entry.group.textSize, TIMELINE_GROUP_TEXT_SIZE_OPTIONS.map((option) => option.value), "regular");
  return `project-timeline-item project-timeline-item--${entry.kind} ${durationClass} project-timeline-item--grouped project-timeline-item-text--${textSize}`;
}

function timelineGroupStyle(group: PostgresTimelineGroup | null): string {
  if (!group) return "";
  const background = normalizeTimelineColor(group.backgroundColor, TIMELINE_DEFAULT_GROUP_BACKGROUND);
  const transparency = timelineBackgroundTransparencyFromFill(group.backgroundFill);
  const opacity = 100 - transparency;
  const rowBackground = opacity <= 0 ? "transparent" : translucentTimelineFill(background, timelineAlphaHexFromPercent(opacity));
  return `--timeline-row-background: ${rowBackground}; --timeline-group-background: ${rowBackground};`;
}

function timelineGroupRowClassKey(groupId: string): string {
  return `project-timeline-row-id-${groupId.replace(/[^a-z0-9_-]/gi, "-")}`;
}

function timelineGroupContentElement(kind: string, label: string, count: number, group: PostgresTimelineGroup | null = null): HTMLElement {
  const root = document.createElement("span");
  root.className = `project-timeline-group project-timeline-group--${kind}`;
  if (group) {
    root.setAttribute("data-timeline-group-key", `group:${group.id}`);
    const textSize = normalizeTimelineGroupOption(group.textSize, TIMELINE_GROUP_TEXT_SIZE_OPTIONS.map((option) => option.value), "regular");
    root.classList.add(`project-timeline-group-text--${textSize}`);
  }
  if (group?.color) {
    root.style.setProperty("--timeline-group-color", normalizeTimelineColor(group.color, TIMELINE_DEFAULT_GROUP_COLOR));
  }

  const name = document.createElement("span");
  name.className = "project-timeline-group-name";
  name.textContent = label;
  root.appendChild(name);

  const countBadge = document.createElement("span");
  countBadge.className = "project-timeline-group-count";
  countBadge.textContent = String(count);
  root.appendChild(countBadge);

  return root;
}

function timelineObjectShapePoints(shape: TimelineObjectShape): string {
  switch (shape) {
    case "rectangle":
      return "4,4 20,4 20,20 4,20";
    case "triangle":
      return "12,4 21,20 3,20";
    case "diamond":
      return "12,3 21,12 12,21 3,12";
    case "hexagon":
      return "7,4 17,4 22,12 17,20 7,20 2,12";
    case "octagon":
      return "8,3 16,3 21,8 21,16 16,21 8,21 3,16 3,8";
    case "parallelogram":
      return "8,4 21,4 16,20 3,20";
    case "trapezoid":
      return "7,4 17,4 21,20 3,20";
    case "tag":
      return "3,4 16,4 22,12 16,20 3,20";
    case "star":
      return "12,3 14.3,8.8 20.5,8.8 15.5,12.6 17.5,19 12,15.2 6.5,19 8.5,12.6 3.5,8.8 9.7,8.8";
    case "rounded":
    default:
      return "";
  }
}

function appendTimelineObjectVisualSvg(
  visual: HTMLElement,
  shape: TimelineObjectShape,
  fill: "filled" | "outline",
  fillColor: string,
  outlineColor: string,
) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "project-timeline-item-object-svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  const shapeElement = shape === "rounded"
    ? document.createElementNS("http://www.w3.org/2000/svg", "circle")
    : document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  if (shape === "rounded") {
    shapeElement.setAttribute("cx", "12");
    shapeElement.setAttribute("cy", "12");
    shapeElement.setAttribute("r", "8.25");
  } else {
    shapeElement.setAttribute("points", timelineObjectShapePoints(shape));
  }
  shapeElement.setAttribute("class", "project-timeline-item-object-shape");
  shapeElement.setAttribute("fill", fill === "outline" ? "transparent" : fillColor);
  shapeElement.setAttribute("stroke", outlineColor);
  shapeElement.setAttribute("stroke-width", "2.5");
  shapeElement.setAttribute("stroke-linejoin", "round");
  shapeElement.setAttribute("vector-effect", "non-scaling-stroke");
  svg.appendChild(shapeElement);
  visual.appendChild(svg);
}

function timelineItemContentElement(entry: PostgresProjectTimelineEntry): HTMLElement {
  const root = document.createElement("span");
  root.className = `project-timeline-item-content${entry.end ? "" : " project-timeline-item-content--point"}`;

  if (!entry.end) {
    const pointLine = document.createElement("span");
    pointLine.className = "project-timeline-point-line";
    root.appendChild(pointLine);
  }

  const visual = document.createElement("span");
  visual.className = `project-timeline-item-visual project-timeline-item-visual--${entry.kind}`;
  visual.style.setProperty("--timeline-item-fill", entry.visualFillColor ?? entry.fillColor);
  visual.style.setProperty("--timeline-item-outline", entry.visualOutlineColor ?? entry.outlineColor);

  if (entry.kind === "source") {
    const sourceVisualKey = entry.sourceVisualKey ?? "source_text";
    visual.classList.add("project-timeline-item-visual--source-icon");
    visual.style.setProperty("--timeline-source-icon", `url("${TIMELINE_SOURCE_VISUALS[sourceVisualKey]}")`);
  } else if (entry.kind === "object") {
    const shape = entry.visualShape ?? "rounded";
    const fill = entry.visualFill ?? "filled";
    visual.classList.add(`project-timeline-item-visual-fill--${fill}`);
    appendTimelineObjectVisualSvg(
      visual,
      shape,
      fill,
      entry.visualFillColor ?? entry.fillColor,
      entry.visualOutlineColor ?? entry.outlineColor,
    );
  } else {
    const line = document.createElement("span");
    const lineShape = entry.lineShape ?? "solid";
    const arrowhead = entry.arrowhead ?? "one_sided";
    line.className = `project-timeline-item-relationship-line project-timeline-item-relationship-line--${lineShape}`;
    line.style.borderTopWidth = `${Math.max(1, normalizeTimelineRelationshipLineWeight(entry.lineWeight) + 1)}px`;
    visual.appendChild(line);
    if (arrowhead !== "none") {
      const arrow = document.createElement("span");
      arrow.className = "project-timeline-item-relationship-arrow project-timeline-item-relationship-arrow--target";
      visual.appendChild(arrow);
      if (arrowhead === "double_sided") {
        const sourceArrow = document.createElement("span");
        sourceArrow.className = "project-timeline-item-relationship-arrow project-timeline-item-relationship-arrow--source";
        visual.appendChild(sourceArrow);
      }
    }
  }
  root.appendChild(visual);

  const title = document.createElement("span");
  title.className = "project-timeline-item-title";
  title.textContent = entry.title;
  root.appendChild(title);

  return root;
}

function parseTimelineDate(value: string | null | undefined): Date | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) return null;
  return new Date(timestamp);
}

function formatTimelineInputDateTime(date: Date): string {
  const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
  return local.toISOString().slice(0, 16);
}

function timelineRoleDefinition<T extends { timelineRole: string; dataType: string }>(
  definitions: T[],
  role: PostgresTimelineAttributeRole,
): T | null {
  return definitions.find((definition) => definition.timelineRole === role) ?? null;
}

function sourceDefinitionAppliesToKind(definition: PostgresSourceAttributeDefinition, sourceKind: string): boolean {
  const normalizedSourceKind = normalizeTimelineSourceKind(sourceKind);
  return (definition.sourceKinds ?? []).some((kind) => normalizeTimelineSourceKind(kind) === normalizedSourceKind);
}

export function PostgresProjectHomeTimelineView({
  sources,
  sourceTypeSettings,
  sourceAttributeDefinitions,
  sourceAttributeValues,
  objects,
  objectTypes,
  objectAttributeDefinitions,
  relationships,
  relationshipTypes,
  relationshipAttributeDefinitions,
  timelineGroups,
  timelineGroupRowOrders,
  timelineItemGroupAssignments,
  canManageSources,
  onCreateSource,
  onCreateObject,
  onCreateRelationship,
  onTimelineItemContextMenu,
  onSaveTimelineGroup,
  onDeleteTimelineGroup,
  onReorderTimelineGroups,
  onReorderTimelineGroupRows,
  onSetTimelineItemGroup,
}: {
  sources: PostgresSource[];
  sourceTypeSettings: PostgresSourceTypeSetting[];
  sourceAttributeDefinitions: PostgresSourceAttributeDefinition[];
  sourceAttributeValues: PostgresSourceAttributeValue[];
  objects: PostgresObject[];
  objectTypes: PostgresObjectType[];
  objectAttributeDefinitions: PostgresObjectAttributeDefinition[];
  relationships: PostgresRelationship[];
  relationshipTypes: PostgresRelationshipType[];
  relationshipAttributeDefinitions: PostgresRelationshipAttributeDefinition[];
  timelineGroups: PostgresTimelineGroup[];
  timelineGroupRowOrders: PostgresTimelineGroupRowOrder[];
  timelineItemGroupAssignments: PostgresTimelineItemGroupAssignment[];
  canManageSources: boolean;
  canManageAnnotations: boolean;
  onCreateSource: (timelineStart?: string) => void;
  onCreateObject: (timelineStart?: string) => void;
  onCreateRelationship: (timelineStart?: string) => void;
  onCreateCode: () => void;
  onTimelineItemContextMenu?: (context: {
    kind: PostgresProjectTimelineItemKind;
    id: string;
    groupId: string;
    clientX: number;
    clientY: number;
  }) => void;
  onSaveTimelineGroup: (draft: {
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
    textSize: string;
  }) => Promise<PostgresTimelineGroup>;
  onDeleteTimelineGroup: (groupId: string) => Promise<void>;
  onReorderTimelineGroups: (groupIds: string[]) => Promise<void>;
  onReorderTimelineGroupRows: (groupKeys: string[]) => Promise<void>;
  onSetTimelineItemGroup: (request: {
    itemKind: PostgresProjectTimelineItemKind;
    itemId: string;
    groupId: string | null;
  }) => Promise<void>;
}) {
  const timelineContainerRef = useRef<HTMLDivElement | null>(null);
  const createControlRef = useRef<HTMLDivElement | null>(null);
  const rowOrderSaveTimerRef = useRef<number | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [createItemMenuOpen, setCreateItemMenuOpen] = useState(false);
  const [groupModalDraft, setGroupModalDraft] = useState<PostgresTimelineGroup | null | "new">(null);
  const [groupModalTab, setGroupModalTab] = useState<"details" | "appearance" | "items">("details");
  const [groupModalName, setGroupModalName] = useState("");
  const [groupModalDescription, setGroupModalDescription] = useState("");
  const [groupModalColor, setGroupModalColor] = useState(TIMELINE_DEFAULT_GROUP_COLOR);
  const [groupModalOutlineColor, setGroupModalOutlineColor] = useState(TIMELINE_DEFAULT_GROUP_COLOR);
  const [groupModalBackgroundColor, setGroupModalBackgroundColor] = useState(TIMELINE_DEFAULT_GROUP_BACKGROUND);
  const [groupModalItemFill, setGroupModalItemFill] = useState("filled");
  const [groupModalItemFillTransparency, setGroupModalItemFillTransparency] = useState(86);
  const [groupModalBackgroundTransparency, setGroupModalBackgroundTransparency] = useState(87);
  const [groupModalTextSize, setGroupModalTextSize] = useState("regular");
  const [groupModalSaving, setGroupModalSaving] = useState(false);
  const [groupModalError, setGroupModalError] = useState("");
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [timelineGroupContextMenu, setTimelineGroupContextMenu] = useState<{
    groupId: string;
    x: number;
    y: number;
  } | null>(null);
  const [timelineBackgroundContextMenu, setTimelineBackgroundContextMenu] = useState<{
    x: number;
    y: number;
    timelineStart: string;
  } | null>(null);
  const [selectedTimelineEntryId, setSelectedTimelineEntryId] = useState<string | null>(null);
  const [timelineAppearanceModalOpen, setTimelineAppearanceModalOpen] = useState(false);
  const [timelineAppearance, setTimelineAppearance] = useState<TimelineAppearanceSettings>(() => loadTimelineAppearanceSettings());
  const timelineAppearanceFontSizeIndex = Math.max(0, TIMELINE_GROUP_TEXT_SIZE_ORDER.indexOf(timelineAppearance.fontSize));
  function setTimelineAppearanceFontSize(fontSize: TimelineAppearanceSettings["fontSize"]) {
    const next = { ...timelineAppearance, fontSize };
    setTimelineAppearance(next);
    saveTimelineAppearanceSettings(next);
  }
  function adjustTimelineAppearanceFontSize(direction: -1 | 1) {
    const nextIndex = Math.max(0, Math.min(TIMELINE_GROUP_TEXT_SIZE_ORDER.length - 1, timelineAppearanceFontSizeIndex + direction));
    setTimelineAppearanceFontSize(TIMELINE_GROUP_TEXT_SIZE_ORDER[nextIndex] as TimelineAppearanceSettings["fontSize"]);
  }
  const timelineGroupById = useMemo(() => new Map(timelineGroups.map((group) => [group.id, group])), [timelineGroups]);
  const timelineRowOrderByKey = useMemo(
    () => new Map(timelineGroupRowOrders.map((rowOrder) => [rowOrder.groupKey, rowOrder.sortOrder])),
    [timelineGroupRowOrders],
  );
  const assignmentByItemKey = useMemo(
    () => new Map(timelineItemGroupAssignments.map((assignment) => [`${assignment.itemKind}:${assignment.itemId}`, assignment])),
    [timelineItemGroupAssignments],
  );
  function openTimelineGroupModal(group: PostgresTimelineGroup | null = null) {
    setGroupModalDraft(group ?? "new");
    setGroupModalTab("details");
    setGroupModalName(group?.name ?? "");
    setGroupModalDescription(group?.description ?? "");
    setGroupModalColor(group?.color || TIMELINE_DEFAULT_GROUP_COLOR);
    setGroupModalOutlineColor(group?.outlineColor || group?.color || TIMELINE_DEFAULT_GROUP_COLOR);
    setGroupModalBackgroundColor(group?.backgroundColor || TIMELINE_DEFAULT_GROUP_BACKGROUND);
    setGroupModalItemFill(group?.itemFill || "filled");
    setGroupModalItemFillTransparency(normalizeTimelinePercent(group?.itemFillTransparency, 86));
    setGroupModalBackgroundTransparency(timelineBackgroundTransparencyFromFill(group?.backgroundFill));
    setGroupModalTextSize(group?.textSize || "regular");
    setGroupModalError("");
  }

  async function submitTimelineGroupModal() {
    if (!groupModalDraft || groupModalSaving) return;
    const name = groupModalName.trim();
    if (!name) {
      setGroupModalError("Timeline group name is required.");
      return;
    }
    setGroupModalSaving(true);
    setGroupModalError("");
    try {
      const isNewGroup = groupModalDraft === "new";
      const savedGroup = await onSaveTimelineGroup({
        groupId: groupModalDraft === "new" ? null : groupModalDraft.id,
        name,
        description: groupModalDescription.trim(),
        icon: "group",
        color: groupModalColor,
        outlineColor: groupModalOutlineColor,
        backgroundColor: groupModalBackgroundColor,
        itemFill: groupModalItemFill,
        itemFillTransparency: groupModalItemFillTransparency,
        backgroundFill: `transparency:${Math.max(0, Math.min(100, Math.round(groupModalBackgroundTransparency)))}`,
        textSize: groupModalTextSize,
      });
      if (isNewGroup) {
        const newGroupKey = `group:${savedGroup.id}`;
        await onReorderTimelineGroupRows([...currentTimelineGroupOrderKeys.filter((groupKey) => groupKey !== newGroupKey), newGroupKey]);
      }
      setGroupModalDraft(null);
    } catch (saveError) {
      setGroupModalError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setGroupModalSaving(false);
    }
  }
  async function deleteTimelineGroup(group: PostgresTimelineGroup) {
    setDeletingGroupId(group.id);
    setGroupModalError("");
    try {
      await onDeleteTimelineGroup(group.id);
      setGroupModalDraft((current) => {
        if (current && current !== "new" && current.id === group.id) return null;
        return current;
      });
    } catch (deleteError) {
      setGroupModalDraft(group);
      setGroupModalError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setDeletingGroupId(null);
    }
  }
  const timelineEntries = useMemo<PostgresProjectTimelineEntry[]>(() => {
    const entries: PostgresProjectTimelineEntry[] = [];
    const sourceValueByKey = new Map(
      sourceAttributeValues.map((value) => [`${value.sourceId}:${value.attributeDefinitionId}`, value.value]),
    );
    const objectTypeById = new Map(objectTypes.map((objectType) => [objectType.id, objectType]));
    const relationshipTypeById = new Map(relationshipTypes.map((relationshipType) => [relationshipType.id, relationshipType]));

    for (const source of sources) {
      const definitions = sourceAttributeDefinitions.filter((definition) => sourceDefinitionAppliesToKind(definition, source.sourceKind));
      const startDefinition = timelineRoleDefinition(definitions, "timeline_start");
      if (!startDefinition) continue;
      const start = parseTimelineDate(sourceValueByKey.get(`${source.id}:${startDefinition.id}`));
      if (!start) continue;
      const endDefinition = timelineRoleDefinition(definitions, "timeline_end");
      const labelDefinition = timelineRoleDefinition(definitions, "timeline_label");
      const typeDefinition = timelineRoleDefinition(definitions, "timeline_item_type");
      const end = endDefinition ? parseTimelineDate(sourceValueByKey.get(`${source.id}:${endDefinition.id}`)) : null;
      const sourceTypeLabel = formatPostgresSourceKindLabel(source.sourceKind);
      const colors = resolveSourceTimelineColors(source.sourceKind, sourceTypeSettings);
      const assignment = assignmentByItemKey.get(`source:${source.id}`);
      const assignedGroup = assignment ? timelineGroupById.get(assignment.groupId) ?? null : null;
      entries.push({
        id: `source:${source.id}`,
        itemKind: "source",
        itemId: source.id,
        kind: "source",
        title: labelDefinition ? sourceValueByKey.get(`${source.id}:${labelDefinition.id}`)?.trim() || source.title : source.title,
        typeLabel: sourceTypeLabel,
        itemType: typeDefinition ? sourceValueByKey.get(`${source.id}:${typeDefinition.id}`)?.trim() || "" : "",
        groupId: assignedGroup ? `group:${assignedGroup.id}` : TIMELINE_UNASSIGNED_GROUP_ID,
        groupLabel: assignedGroup?.name || TIMELINE_UNASSIGNED_GROUP_LABEL,
        groupKind: "custom",
        start,
        end: end && end >= start ? end : null,
        group: assignedGroup,
        sourceVisualKey: timelineSourceVisualKey(source.sourceKind),
        ...colors,
      });
    }

    for (const object of objects) {
      const objectType = objectTypeById.get(object.objectTypeId) ?? null;
      const definitions = objectAttributeDefinitions.filter((definition) => definition.objectTypeId === object.objectTypeId);
      const startDefinition = timelineRoleDefinition(definitions, "timeline_start");
      if (!startDefinition) continue;
      const valueByDefinitionId = new Map(object.attributeValues.map((value) => [value.attributeDefinitionId, value.value]));
      const start = parseTimelineDate(valueByDefinitionId.get(startDefinition.id));
      if (!start) continue;
      const endDefinition = timelineRoleDefinition(definitions, "timeline_end");
      const labelDefinition = timelineRoleDefinition(definitions, "timeline_label");
      const typeDefinition = timelineRoleDefinition(definitions, "timeline_item_type");
      const end = endDefinition ? parseTimelineDate(valueByDefinitionId.get(endDefinition.id)) : null;
      const colors = resolveObjectTimelineColors(object, objectType);
      const assignment = assignmentByItemKey.get(`object:${object.id}`);
      const assignedGroup = assignment ? timelineGroupById.get(assignment.groupId) ?? null : null;
      const objectTypeLabel = object.objectType || "Object";
      entries.push({
        id: `object:${object.id}`,
        itemKind: "object",
        itemId: object.id,
        kind: "object",
        title: labelDefinition ? valueByDefinitionId.get(labelDefinition.id)?.trim() || object.title : object.title,
        typeLabel: objectTypeLabel,
        itemType: typeDefinition ? valueByDefinitionId.get(typeDefinition.id)?.trim() || "" : "",
        groupId: assignedGroup ? `group:${assignedGroup.id}` : TIMELINE_UNASSIGNED_GROUP_ID,
        groupLabel: assignedGroup?.name || TIMELINE_UNASSIGNED_GROUP_LABEL,
        groupKind: "custom",
        start,
        end: end && end >= start ? end : null,
        group: assignedGroup,
        visualShape: normalizeTimelineObjectShape(object.shapeOverride || objectType?.shape),
        visualFill: normalizeTimelineObjectFill(object.fillOverride || objectType?.fill),
        ...colors,
      });
    }

    for (const relationship of relationships) {
      const relationshipType = relationshipTypeById.get(relationship.relationshipTypeId) ?? null;
      const definitions = relationshipAttributeDefinitions.filter((definition) => definition.relationshipTypeId === relationship.relationshipTypeId);
      const startDefinition = timelineRoleDefinition(definitions, "timeline_start");
      if (!startDefinition) continue;
      const valueByDefinitionId = new Map(relationship.attributeValues.map((value) => [value.attributeDefinitionId, value.value]));
      const start = parseTimelineDate(valueByDefinitionId.get(startDefinition.id));
      if (!start) continue;
      const endDefinition = timelineRoleDefinition(definitions, "timeline_end");
      const labelDefinition = timelineRoleDefinition(definitions, "timeline_label");
      const typeDefinition = timelineRoleDefinition(definitions, "timeline_item_type");
      const end = endDefinition ? parseTimelineDate(valueByDefinitionId.get(endDefinition.id)) : null;
      const fallbackTitle = relationship.relationshipType || `${relationship.fromEntityName} - ${relationship.toEntityName}`;
      const colors = resolveRelationshipTimelineColors(relationship, relationshipType);
      const relationshipTypeLabel = relationship.relationshipType || "Relationship";
      const assignment = assignmentByItemKey.get(`relationship:${relationship.id}`);
      const assignedGroup = assignment ? timelineGroupById.get(assignment.groupId) ?? null : null;
      const lineShape = normalizeTimelineRelationshipLineShape(relationship.lineShapeOverride || relationshipType?.lineShape);
      const lineWeight = normalizeTimelineRelationshipLineWeight(relationship.lineWeightOverride ?? relationshipType?.lineWeight);
      const arrowhead = normalizeTimelineRelationshipArrowhead(relationship.arrowheadOverride || relationshipType?.arrowhead);
      entries.push({
        id: `relationship:${relationship.id}`,
        itemKind: "relationship",
        itemId: relationship.id,
        kind: "relationship",
        title: labelDefinition ? valueByDefinitionId.get(labelDefinition.id)?.trim() || fallbackTitle : fallbackTitle,
        typeLabel: relationshipTypeLabel,
        itemType: typeDefinition ? valueByDefinitionId.get(typeDefinition.id)?.trim() || "" : "",
        groupId: assignedGroup ? `group:${assignedGroup.id}` : TIMELINE_UNASSIGNED_GROUP_ID,
        groupLabel: assignedGroup?.name || TIMELINE_UNASSIGNED_GROUP_LABEL,
        groupKind: "custom",
        start,
        end: end && end >= start ? end : null,
        group: assignedGroup,
        lineShape,
        lineWeight,
        arrowhead,
        ...colors,
      });
    }

    return entries.sort((left, right) => left.start.getTime() - right.start.getTime() || left.title.localeCompare(right.title, undefined, { sensitivity: "base" }));
  }, [assignmentByItemKey, objects, objectAttributeDefinitions, objectTypes, relationshipAttributeDefinitions, relationships, relationshipTypes, sourceAttributeDefinitions, sourceAttributeValues, sourceTypeSettings, sources, timelineGroupById]);
  const selectedTimelineEntry = useMemo(
    () => timelineEntries.find((entry) => entry.id === selectedTimelineEntryId) ?? null,
    [selectedTimelineEntryId, timelineEntries],
  );
  const selectedTimelineInspectorAttributes = useMemo(() => {
    if (!selectedTimelineEntry) return [];
    return [
      { name: "Start", value: formatTimelineInspectorDate(selectedTimelineEntry.start) },
      ...(selectedTimelineEntry.end ? [{ name: "End", value: formatTimelineInspectorDate(selectedTimelineEntry.end) }] : []),
      { name: "Group", value: selectedTimelineEntry.groupLabel },
    ];
  }, [selectedTimelineEntry]);
  useEffect(() => {
    if (selectedTimelineEntryId && !selectedTimelineEntry) {
      setSelectedTimelineEntryId(null);
    }
  }, [selectedTimelineEntry, selectedTimelineEntryId]);
  const currentTimelineGroupOrderKeys = useMemo(() => {
    const defaultGroupIds = Array.from(new Set(timelineEntries.map((entry) => entry.groupId).filter((id) => id.startsWith("default:"))));
    const defaultGroups = defaultGroupIds.map((id, index) => ({
      id,
      sortOrder: timelineRowOrderByKey.get(id) ?? (1000 + index),
    }));
    const explicitGroups = timelineGroups.map((group) => ({
      id: `group:${group.id}`,
      sortOrder: timelineRowOrderByKey.get(`group:${group.id}`) ?? group.sortOrder,
    }));
    return [...explicitGroups, ...defaultGroups]
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
      .map((group) => group.id);
  }, [timelineEntries, timelineGroups, timelineRowOrderByKey]);

  useEffect(() => {
    const container = timelineContainerRef.current;
    if (!container || timelineEntries.length === 0) return;
    let cancelled = false;
    let timeline: {
      destroy: () => void;
      fit: (options?: { animation?: boolean }) => void;
      getEventProperties?: (event: Event) => { time?: Date };
      setOptions?: (options: Record<string, unknown>) => void;
      on?: (eventName: string, callback: (properties: {
        event?: Event;
        item?: string | number | null;
        items?: Array<string | number>;
        groupId?: string | number | null;
      }) => void) => void;
    } | null = null;
    void Promise.all([
      import("vis-data"),
      import("vis-timeline/standalone"),
    ]).then(([visData, visTimeline]) => {
      if (cancelled) return;
      const entryById = new Map(timelineEntries.map((entry) => [entry.id, entry]));
      const defaultGroupIds = Array.from(new Set(timelineEntries.map((entry) => entry.groupId).filter((id) => id.startsWith("default:"))));
      const groupCounts = timelineEntries.reduce((counts, entry) => {
        counts.set(entry.groupId, (counts.get(entry.groupId) ?? 0) + 1);
        return counts;
      }, new Map<string, number>());
      const defaultGroups = defaultGroupIds.map((id, index) => {
        const entry = timelineEntries.find((candidate) => candidate.groupId === id);
        return {
          id,
          label: entry?.groupLabel ?? "Timeline",
          kind: entry?.groupKind ?? "custom",
          group: null as PostgresTimelineGroup | null,
          sortOrder: timelineRowOrderByKey.get(id) ?? (1000 + index),
        };
      });
      const explicitGroups = timelineGroups.map((group) => ({
        id: `group:${group.id}`,
        label: group.name,
        kind: "custom" as const,
        group,
        sortOrder: timelineRowOrderByKey.get(`group:${group.id}`) ?? group.sortOrder,
      }));
      const timelineGroupRecords = [...explicitGroups, ...defaultGroups];
      const groups = new visData.DataSet(timelineGroupRecords.map((groupRecord) => {
        const id = groupRecord.id;
        const count = groupCounts.get(id) ?? 0;
        const rowClassName = [
          "project-timeline-row",
          `project-timeline-row--${groupRecord.kind}`,
          timelineGroupRowClassKey(id),
        ].join(" ");
        return {
          id,
          className: rowClassName,
          content: timelineGroupContentElement(groupRecord.kind, groupRecord.label, count, groupRecord.group),
          style: timelineGroupStyle(groupRecord.group),
          order: groupRecord.sortOrder,
        };
      }));
      const timelineRowStyle = document.createElement("style");
      timelineRowStyle.setAttribute("data-kanqual-timeline-row-styles", "true");
      timelineRowStyle.textContent = timelineGroupRecords
        .filter((groupRecord) => groupRecord.group)
        .map((groupRecord) => {
          const group = groupRecord.group;
          if (!group) return "";
          const rowBackground = timelineGroupStyle(group).match(/--timeline-row-background:\s*([^;]+);/)?.[1] ?? "transparent";
          const classKey = timelineGroupRowClassKey(groupRecord.id);
          return [
            `.project-home-timeline-card .vis-labelset .vis-label.${classKey},`,
            `.project-home-timeline-card .vis-foreground .vis-group.${classKey} {`,
            `  background: ${rowBackground};`,
            `}`,
          ].join("\n");
        })
        .join("\n");
      const persistTimelineGroupOrder = () => {
        const orderedIds = groups.get({
          order: (left: { order?: number; id?: string | number }, right: { order?: number; id?: string | number }) => {
            const leftOrder = left.order ?? 0;
            const rightOrder = right.order ?? 0;
            if (leftOrder !== rightOrder) return leftOrder - rightOrder;
            return String(left.id ?? "").localeCompare(String(right.id ?? ""));
          },
        }).map((group: { id?: string | number }) => String(group.id ?? "")).filter(Boolean);
        if (orderedIds.length > 0) {
          void onReorderTimelineGroupRows(orderedIds);
          const customGroupIds = orderedIds
            .filter((id) => id.startsWith("group:"))
            .map((id) => id.slice("group:".length));
          if (customGroupIds.length > 0) {
            void onReorderTimelineGroups(customGroupIds);
          }
        }
      };
      const schedulePersistTimelineGroupOrder = () => {
        if (rowOrderSaveTimerRef.current != null) {
          window.clearTimeout(rowOrderSaveTimerRef.current);
        }
        rowOrderSaveTimerRef.current = window.setTimeout(() => {
          rowOrderSaveTimerRef.current = null;
          persistTimelineGroupOrder();
        }, 0);
      };
      const items = new visData.DataSet(timelineEntries.map((entry) => {
        return {
          id: entry.id,
          group: entry.groupId,
          content: entry.title,
          title: `${entry.title}\n${entry.kind}: ${entry.typeLabel}`,
          start: entry.start,
          ...(entry.end ? { end: entry.end, type: "range" } : {}),
          className: timelineItemClassName(entry),
          style: timelineItemStyle(entry.fillColor, entry.outlineColor, entry.group),
        };
      }));
      timeline = new visTimeline.Timeline(container, items, groups, {
        stack: true,
        groupOrder: "order",
        groupEditable: canManageSources ? { order: true } : false,
        groupOrderSwap: (
          fromGroup: any,
          toGroup: any,
        ) => {
          if (!canManageSources) return;
          const fromOrder = fromGroup.order ?? 0;
          const toOrder = toGroup.order ?? 0;
          fromGroup.order = toOrder;
          toGroup.order = fromOrder;
        },
        onMoveGroup: (group: TimelineGroup, callback: (group: TimelineGroup | null) => void) => callback(group),
        editable: canManageSources ? { updateGroup: true, updateTime: true, add: false, remove: false, overrideItems: false } : false,
        itemsAlwaysDraggable: canManageSources ? { item: true, range: false } : false,
        onMoving: (item: TimelineItem, callback: (item: TimelineItem | null) => void) => {
          const rawItemId = item.id == null ? "" : String(item.id);
          const entry = entryById.get(rawItemId);
          if (!entry || !canManageSources) {
            callback(null);
            return;
          }
          item.start = entry.start;
          if (entry.end) {
            item.end = entry.end;
          } else {
            delete item.end;
          }
          callback(item);
        },
        onMove: (item: TimelineItem, callback: (item: TimelineItem | null) => void) => {
          const rawItemId = item.id == null ? "" : String(item.id);
          const entry = entryById.get(rawItemId);
          if (!entry || !canManageSources) {
            callback(null);
            return;
          }
          item.start = entry.start;
          if (entry.end) {
            item.end = entry.end;
          } else {
            delete item.end;
          }
          const rawGroupId = item.group == null ? "" : String(item.group);
          const nextGroupId = rawGroupId.startsWith("group:") ? rawGroupId.slice("group:".length) : null;
          callback(item);
          void onSetTimelineItemGroup({
            itemKind: entry.itemKind,
            itemId: entry.itemId,
            groupId: nextGroupId,
          });
        },
        horizontalScroll: false,
        verticalScroll: true,
        zoomKey: "",
        zoomable: true,
        orientation: "top",
        margin: { item: 10, axis: 12 },
        maxHeight: "100%",
        minHeight: "100%",
        template: (item: TimelineItem) => {
          const rawItemId = item.id == null ? "" : String(item.id);
          const entry = entryById.get(rawItemId);
          return entry ? timelineItemContentElement(entry) : String(item.content ?? "");
        },
        tooltip: { followMouse: true },
      });
      container.appendChild(timelineRowStyle);
      timeline.on?.("contextmenu", (properties) => {
        const rawItemId = properties.item == null ? "" : String(properties.item);
        const nativeEvent = properties.event;
        if (!(nativeEvent instanceof MouseEvent)) return;
        if (!rawItemId) {
          const target = nativeEvent.target;
          if (target instanceof Element) {
            const labelElement = target.closest<HTMLElement>(".vis-labelset .vis-label.project-timeline-row");
            const groupElement = labelElement?.querySelector<HTMLElement>(".project-timeline-group[data-timeline-group-key]");
            const rawGroupKey = groupElement?.dataset.timelineGroupKey ?? "";
            if (rawGroupKey.startsWith("group:")) {
              const groupId = rawGroupKey.slice("group:".length);
              if (timelineGroupById.has(groupId) && canManageSources) {
                nativeEvent.preventDefault();
                nativeEvent.stopPropagation();
                setCreateMenuOpen(false);
                setCreateItemMenuOpen(false);
                setTimelineBackgroundContextMenu(null);
                setTimelineGroupContextMenu({
                  groupId,
                  x: Math.min(nativeEvent.clientX, window.innerWidth - 180),
                  y: Math.min(nativeEvent.clientY, window.innerHeight - 110),
                });
              }
              return;
            }
            if (target.closest(".vis-labelset")) return;
          }
          nativeEvent.preventDefault();
          nativeEvent.stopPropagation();
          const eventProperties = timeline?.getEventProperties?.(nativeEvent);
          const time = eventProperties?.time instanceof Date ? eventProperties.time : new Date();
          setTimelineGroupContextMenu(null);
          setCreateMenuOpen(false);
          setCreateItemMenuOpen(false);
          setTimelineBackgroundContextMenu({
            x: Math.min(nativeEvent.clientX, window.innerWidth - 190),
            y: Math.min(nativeEvent.clientY, window.innerHeight - 170),
            timelineStart: formatTimelineInputDateTime(time),
          });
          return;
        }
        const [kind, ...idParts] = rawItemId.split(":");
        const id = idParts.join(":");
        const entry = entryById.get(rawItemId);
        if (
          !id
          || !entry
          || (kind !== "source" && kind !== "object" && kind !== "relationship")
          || !(nativeEvent instanceof MouseEvent)
        ) {
          return;
        }
        onTimelineItemContextMenu?.({
          kind,
          id,
          groupId: entry.groupId,
          clientX: nativeEvent.clientX,
          clientY: nativeEvent.clientY,
        });
      });
      timeline.on?.("select", (properties) => {
        const rawItemId = properties.items?.[0] == null ? "" : String(properties.items[0]);
        setSelectedTimelineEntryId(entryById.has(rawItemId) ? rawItemId : null);
      });
      timeline.on?.("groupDragged", () => {
        schedulePersistTimelineGroupOrder();
      });
      timeline.fit({ animation: false });
      const cursorGuide = document.createElement("div");
      cursorGuide.className = "project-home-timeline-cursor-guide";
      cursorGuide.setAttribute("aria-hidden", "true");
      const cursorLabel = document.createElement("div");
      cursorLabel.className = "project-home-timeline-cursor-label";
      cursorGuide.appendChild(cursorLabel);
      container.appendChild(cursorGuide);
      const hideTimelineCursorGuide = () => {
        cursorGuide.classList.remove("project-home-timeline-cursor-guide--visible");
      };
      const formatTimelineCursorDate = (date: Date) => new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
      const updateTimelineCursorGuide = (event: PointerEvent) => {
        const centerPanel = container.querySelector<HTMLElement>(".vis-panel.vis-center");
        if (!centerPanel || !timeline?.getEventProperties) {
          hideTimelineCursorGuide();
          return;
        }
        const centerRect = centerPanel.getBoundingClientRect();
        if (
          event.clientX < centerRect.left
          || event.clientX > centerRect.right
          || event.clientY < centerRect.top
          || event.clientY > centerRect.bottom
        ) {
          hideTimelineCursorGuide();
          return;
        }
        const containerRect = container.getBoundingClientRect();
        const eventProperties = timeline.getEventProperties(event);
        const time = eventProperties.time instanceof Date ? eventProperties.time : null;
        if (!time) {
          hideTimelineCursorGuide();
          return;
        }
        const x = event.clientX - containerRect.left;
        cursorGuide.style.left = `${x}px`;
        cursorGuide.style.top = `${centerRect.top - containerRect.top}px`;
        cursorGuide.style.height = `${centerRect.height}px`;
        cursorLabel.textContent = formatTimelineCursorDate(time);
        cursorGuide.classList.add("project-home-timeline-cursor-guide--visible");
      };
      const clearHoveredTimelineRows = () => {
        container
          .querySelectorAll(".project-timeline-row--hover")
          .forEach((element) => element.classList.remove("project-timeline-row--hover"));
      };
      const handleTimelineRowPointerMove = (event: PointerEvent) => {
        const labels = Array.from(container.querySelectorAll<HTMLElement>(".vis-labelset .vis-label.project-timeline-row"));
        const foregroundRows = Array.from(container.querySelectorAll<HTMLElement>(".vis-foreground .vis-group.project-timeline-row"));
        const rowIndex = [...labels, ...foregroundRows].findIndex((row) => {
          const rect = row.getBoundingClientRect();
          return event.clientY >= rect.top && event.clientY <= rect.bottom;
        });
        const normalizedIndex = rowIndex >= labels.length ? rowIndex - labels.length : rowIndex;
        clearHoveredTimelineRows();
        if (normalizedIndex < 0) return;
        labels[normalizedIndex]?.classList.add("project-timeline-row--hover");
        foregroundRows[normalizedIndex]?.classList.add("project-timeline-row--hover");
      };
      const handleTimelineGroupContextMenu = (event: MouseEvent) => {
        if (!canManageSources) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        const labelElement = target.closest<HTMLElement>(".vis-labelset .vis-label.project-timeline-row");
        if (!labelElement) return;
        const groupElement = labelElement.querySelector<HTMLElement>(".project-timeline-group[data-timeline-group-key]");
        const rawGroupKey = groupElement?.dataset.timelineGroupKey ?? "";
        if (!rawGroupKey.startsWith("group:")) return;
        const groupId = rawGroupKey.slice("group:".length);
        if (!timelineGroupById.has(groupId)) return;
        event.preventDefault();
        event.stopPropagation();
        setCreateMenuOpen(false);
        setCreateItemMenuOpen(false);
        setTimelineGroupContextMenu({
          groupId,
          x: Math.min(event.clientX, window.innerWidth - 180),
          y: Math.min(event.clientY, window.innerHeight - 110),
        });
      };
      container.addEventListener("pointermove", handleTimelineRowPointerMove);
      container.addEventListener("pointermove", updateTimelineCursorGuide);
      container.addEventListener("pointerleave", clearHoveredTimelineRows);
      container.addEventListener("pointerleave", hideTimelineCursorGuide);
      container.addEventListener("contextmenu", handleTimelineGroupContextMenu);
      const removeTimelineRowHoverListeners = () => {
        container.removeEventListener("pointermove", handleTimelineRowPointerMove);
        container.removeEventListener("pointermove", updateTimelineCursorGuide);
        container.removeEventListener("pointerleave", clearHoveredTimelineRows);
        container.removeEventListener("pointerleave", hideTimelineCursorGuide);
        container.removeEventListener("contextmenu", handleTimelineGroupContextMenu);
        clearHoveredTimelineRows();
        cursorGuide.remove();
        timelineRowStyle.remove();
      };
      timeline.on?.("destroy", removeTimelineRowHoverListeners);
      (timeline as typeof timeline & { removeTimelineRowHoverListeners?: () => void }).removeTimelineRowHoverListeners = removeTimelineRowHoverListeners;
    });
    return () => {
      cancelled = true;
      if (rowOrderSaveTimerRef.current != null) {
        window.clearTimeout(rowOrderSaveTimerRef.current);
        rowOrderSaveTimerRef.current = null;
      }
      (timeline as typeof timeline & { removeTimelineRowHoverListeners?: () => void })?.removeTimelineRowHoverListeners?.();
      timeline?.destroy();
    };
  }, [canManageSources, onReorderTimelineGroupRows, onReorderTimelineGroups, onSetTimelineItemGroup, onTimelineItemContextMenu, timelineEntries, timelineGroupById, timelineGroups, timelineRowOrderByKey]);

  useEffect(() => {
    if (!createMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (createControlRef.current?.contains(target)) return;
      setCreateMenuOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [createMenuOpen]);

  useEffect(() => {
    if (!timelineGroupContextMenu) return;
    const handlePointerDown = () => setTimelineGroupContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTimelineGroupContextMenu(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [timelineGroupContextMenu]);

  useEffect(() => {
    if (!timelineBackgroundContextMenu) return;
    const handlePointerDown = () => setTimelineBackgroundContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTimelineBackgroundContextMenu(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [timelineBackgroundContextMenu]);

  useEffect(() => {
    if (createMenuOpen) return;
    setCreateItemMenuOpen(false);
  }, [createMenuOpen]);

  const closeTimelineCreateMenus = () => {
    setCreateMenuOpen(false);
    setCreateItemMenuOpen(false);
  };

  const handleCreateTimelineGroup = () => {
    closeTimelineCreateMenus();
    openTimelineGroupModal();
  };

  const handleCreateTimelineSource = (timelineStart?: string) => {
    closeTimelineCreateMenus();
    setTimelineBackgroundContextMenu(null);
    onCreateSource(timelineStart);
  };

  const handleCreateTimelineObject = (timelineStart?: string) => {
    closeTimelineCreateMenus();
    setTimelineBackgroundContextMenu(null);
    onCreateObject(timelineStart);
  };

  const handleCreateTimelineRelationship = (timelineStart?: string) => {
    closeTimelineCreateMenus();
    setTimelineBackgroundContextMenu(null);
    onCreateRelationship(timelineStart);
  };

  const renderTimelineCreateControl = (empty = false) => (
    <div
      className={`project-home-canvas-create-control project-home-timeline-create-control${empty ? "" : " project-home-timeline-create-control--dock"}`}
      ref={createControlRef}
    >
      <button
        type="button"
        className="btn btn--primary project-home-canvas-create-main"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setCreateMenuOpen((current) => !current);
        }}
        aria-expanded={createMenuOpen}
        aria-label={createMenuOpen ? "Close create menu" : "Create timeline item"}
      >
        <PlusIcon className="project-home-canvas-create-icon" />
      </button>
      {createMenuOpen ? (
        <div className="project-home-canvas-create-menu project-home-timeline-create-menu" role="menu">
          <button
            type="button"
            className="btn project-home-canvas-create-action"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              handleCreateTimelineGroup();
            }}
            disabled={!canManageSources}
            aria-label="Add group"
            title="Group"
          >
            <CollaborationIcon className="project-home-canvas-create-action-icon" />
          </button>
          <div className="project-home-timeline-create-item-wrap">
            <button
              type="button"
              className="btn project-home-canvas-create-action"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setCreateItemMenuOpen((current) => !current);
              }}
              disabled={!canManageSources}
              aria-expanded={createItemMenuOpen}
              aria-label={createItemMenuOpen ? "Close new item menu" : "Add item"}
              title="Item"
            >
              <PlusIcon className="project-home-canvas-create-action-icon" />
            </button>
            {createItemMenuOpen ? (
              <div className="project-home-canvas-create-menu project-home-timeline-create-submenu" role="menu">
                <button
                  type="button"
                  className="btn project-home-canvas-create-action"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleCreateTimelineSource();
                  }}
                  disabled={!canManageSources}
                  aria-label="Add source"
                  title="Source"
                >
                  <SourceIcon className="project-home-canvas-create-action-icon" />
                </button>
                <button
                  type="button"
                  className="btn project-home-canvas-create-action"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleCreateTimelineObject();
                  }}
                  disabled={!canManageSources}
                  aria-label="Add object"
                  title="Object"
                >
                  <ObjectIcon className="project-home-canvas-create-action-icon" />
                </button>
                <button
                  type="button"
                  className="btn project-home-canvas-create-action"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleCreateTimelineRelationship();
                  }}
                  disabled={!canManageSources}
                  aria-label="Add relationship"
                  title="Relationship"
                >
                  <RelationshipIcon className="project-home-canvas-create-action-icon" />
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );

  const mappedDefinitionsCount = sourceAttributeDefinitions.filter((definition) => definition.timelineRole).length
    + objectAttributeDefinitions.filter((definition) => definition.timelineRole).length
    + relationshipAttributeDefinitions.filter((definition) => definition.timelineRole).length;
  const timelineRenderedGroupCount = Math.max(1, currentTimelineGroupOrderKeys.length);
  const timelineCardStyle = {
    "--project-home-timeline-target-height": `${72 + ((timelineRenderedGroupCount + 1) * timelineAppearance.rowHeight)}px`,
    "--timeline-background-color": timelineAppearance.backgroundColor,
    "--timeline-line-color": timelineAppearance.lineColor,
  } as CSSProperties;

  return (
    <section className={`project-home-timeline-card project-home-timeline-card--font-${timelineAppearance.fontSize}`} style={timelineCardStyle}>
      {timelineEntries.length === 0 ? (
        <div className="project-home-timeline-empty">
          {renderTimelineCreateControl(true)}
          <div className="project-home-timeline-empty-graphic" aria-hidden="true">
            <div className="project-home-timeline-empty-axis" />
            <div className="project-home-timeline-empty-item project-home-timeline-empty-item--source" />
            <div className="project-home-timeline-empty-item project-home-timeline-empty-item--object" />
            <div className="project-home-timeline-empty-item project-home-timeline-empty-item--relationship" />
          </div>
          <p className="project-home-timeline-empty-text">
            {mappedDefinitionsCount === 0
              ? "Add sources, objects, relationships, or codes, then map timeline fields to display them here."
              : "Add start dates to mapped timeline fields to display items here."}
          </p>
        </div>
      ) : (
        <>
          <div className="project-home-timeline-canvas-wrap">
            <div ref={timelineContainerRef} className="project-home-timeline-canvas" />
            {selectedTimelineEntry ? (
              <div className="postgres-explore-inspector-overlay project-home-timeline-inspector-overlay">
                <section className="home-project-card postgres-explore-inspector-card">
                  <h2>{selectedTimelineEntry.title}</h2>
                  <div className="postgres-explore-inspector-kicker">
                    {selectedTimelineEntry.kind.charAt(0).toUpperCase() + selectedTimelineEntry.kind.slice(1)}
                  </div>
                  <div className="postgres-explore-inspector-type-detail">
                    {[selectedTimelineEntry.typeLabel, selectedTimelineEntry.itemType].filter((value) => value.trim()).join(" · ")}
                  </div>
                  {selectedTimelineInspectorAttributes.length > 0 ? (
                    <dl className="postgres-explore-inspector-attributes">
                      {selectedTimelineInspectorAttributes.map((attribute) => (
                        <div key={`${attribute.name}:${attribute.value}`} className="postgres-explore-inspector-attribute">
                          <dt>{attribute.name}</dt>
                          <dd>{attribute.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </section>
              </div>
            ) : null}
            {canManageSources ? (
              <div className="project-home-timeline-group-actions">
                {renderTimelineCreateControl()}
              </div>
            ) : null}
          </div>
        </>
      )}
      {groupModalDraft ? (
        <SettingsModal
          title={groupModalDraft === "new" ? "New Timeline Group" : "Edit Timeline Group"}
          onClose={() => setGroupModalDraft(null)}
          closeDisabled={groupModalSaving}
        >
          <div className="app-settings-modal-body">
            <div className="segmented-control modal-segmented-control" role="tablist" aria-label="Timeline group settings">
              <button
                type="button"
                className={groupModalTab === "details" ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                onClick={() => setGroupModalTab("details")}
              >
                Details
              </button>
              <button
                type="button"
                className={groupModalTab === "appearance" ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                onClick={() => setGroupModalTab("appearance")}
              >
                Appearance
              </button>
              <button
                type="button"
                className={groupModalTab === "items" ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                onClick={() => setGroupModalTab("items")}
              >
                Items
              </button>
            </div>
            {groupModalTab === "details" ? (
              <>
                <label className="form-group">
                  <span className="form-label">Name</span>
                  <input className="form-input" value={groupModalName} onChange={(event) => setGroupModalName(event.target.value)} />
                </label>
                <label className="form-group">
                  <span className="form-label">Description</span>
                  <textarea className="form-input" rows={3} value={groupModalDescription} onChange={(event) => setGroupModalDescription(event.target.value)} />
                </label>
              </>
            ) : groupModalTab === "appearance" ? (
              <div className="timeline-group-graphics-panel">
                  <div className="timeline-group-items-layout">
                    <div className="timeline-group-items-controls">
                      <label className="form-label">
                        Background Color
                        <div className="timeline-group-color-control">
                          <input
                            className="form-input form-input--color"
                            type="color"
                            value={normalizeTimelineColor(groupModalBackgroundColor, TIMELINE_DEFAULT_GROUP_BACKGROUND)}
                            onChange={(event) => setGroupModalBackgroundColor(event.target.value)}
                          />
                          <input
                            className="form-input timeline-group-color-text"
                            value={groupModalBackgroundColor}
                            onChange={(event) => setGroupModalBackgroundColor(event.target.value)}
                          />
                        </div>
                      </label>
                      <label className="form-label timeline-group-opacity-control">
                        Background Transparency
                        <div className="timeline-group-slider-row">
                          <input
                            className="form-range"
                            type="range"
                            min="0"
                            max="100"
                            step="1"
                            value={groupModalBackgroundTransparency}
                            onChange={(event) => setGroupModalBackgroundTransparency(Number(event.target.value))}
                          />
                          <span className="timeline-group-slider-value">{groupModalBackgroundTransparency}%</span>
                        </div>
                      </label>
                    </div>
                    <div className="timeline-group-item-preview-card" aria-label="Timeline group preview">
                      <span className="form-label">Preview</span>
                      <div
                        className="timeline-group-item-preview-row"
                        style={{
                          backgroundColor:
                            groupModalBackgroundTransparency >= 100
                              ? "transparent"
                              : translucentTimelineFill(
                                  normalizeTimelineColor(groupModalBackgroundColor, TIMELINE_DEFAULT_GROUP_BACKGROUND),
                                  timelineAlphaHexFromPercent(100 - groupModalBackgroundTransparency),
                                ),
                        }}
                      >
                        <div className="timeline-group-item-preview-label">
                          {groupModalName.trim() || "Group"}
                        </div>
                        <div className="timeline-group-item-preview-track">
                          <div
                            className={`timeline-group-item-preview timeline-group-item-preview--${groupModalTextSize}`}
                            style={{
                              backgroundColor:
                                groupModalItemFill === "outline"
                                  ? "transparent"
                                  : translucentTimelineFill(
                                      normalizeTimelineColor(groupModalColor, TIMELINE_DEFAULT_GROUP_COLOR),
                                      timelineAlphaHexFromPercent(100 - groupModalItemFillTransparency),
                                    ),
                              borderColor: normalizeTimelineColor(groupModalOutlineColor, TIMELINE_DEFAULT_GROUP_COLOR),
                            }}
                          >
                            Timeline Item
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
              </div>
            ) : (
              <div className="timeline-group-graphics-panel">
                  <div className="timeline-group-items-layout">
                    <div className="timeline-group-items-controls">
                      <label className="form-label">
                        Outline
                        <div className="timeline-group-color-control">
                          <input
                            className="form-input form-input--color"
                            type="color"
                            value={normalizeTimelineColor(groupModalOutlineColor, TIMELINE_DEFAULT_GROUP_COLOR)}
                            onChange={(event) => setGroupModalOutlineColor(event.target.value)}
                          />
                          <input
                            className="form-input timeline-group-color-text"
                            value={groupModalOutlineColor}
                            onChange={(event) => setGroupModalOutlineColor(event.target.value)}
                          />
                        </div>
                      </label>
                      <div className="timeline-group-setting-row">
                        <span className="form-label">Item Text Size</span>
                        <div className="text-size-controls timeline-group-setting-control" aria-label="Timeline group item text size">
                          <button
                            type="button"
                            className="text-size-control-btn text-size-control-btn--decrease"
                            onClick={() => {
                              const currentIndex = TIMELINE_GROUP_TEXT_SIZE_ORDER.indexOf(groupModalTextSize);
                              setGroupModalTextSize(TIMELINE_GROUP_TEXT_SIZE_ORDER[Math.max(0, currentIndex - 1)] ?? "small");
                            }}
                            disabled={groupModalTextSize === "small"}
                            aria-label="Decrease item text size"
                          >
                            A
                          </button>
                          <span className="text-size-control-value">
                            {TIMELINE_GROUP_TEXT_SIZE_OPTIONS.find((option) => option.value === groupModalTextSize)?.label ?? "Regular"}
                          </span>
                          <button
                            type="button"
                            className="text-size-control-btn text-size-control-btn--increase"
                            onClick={() => {
                              const currentIndex = TIMELINE_GROUP_TEXT_SIZE_ORDER.indexOf(groupModalTextSize);
                              setGroupModalTextSize(TIMELINE_GROUP_TEXT_SIZE_ORDER[Math.min(TIMELINE_GROUP_TEXT_SIZE_ORDER.length - 1, currentIndex + 1)] ?? "large");
                            }}
                            disabled={groupModalTextSize === "large"}
                            aria-label="Increase item text size"
                          >
                            A
                          </button>
                        </div>
                      </div>
                      <div className="timeline-group-setting-row">
                        <span className="form-label">Item Fill</span>
                        <div className="segmented-control modal-secondary-segmented-control modal-secondary-segmented-control--two timeline-group-setting-control timeline-group-fill-selector" role="tablist" aria-label="Timeline group item fill">
                          {TIMELINE_GROUP_FILL_OPTIONS.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              className={groupModalItemFill === option.value ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                              onClick={() => setGroupModalItemFill(option.value)}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      {groupModalItemFill === "filled" ? (
                        <label className="form-label">
                          Fill
                          <div className="timeline-group-color-control">
                            <input
                              className="form-input form-input--color"
                              type="color"
                              value={normalizeTimelineColor(groupModalColor, TIMELINE_DEFAULT_GROUP_COLOR)}
                              onChange={(event) => setGroupModalColor(event.target.value)}
                            />
                            <input
                              className="form-input timeline-group-color-text"
                              value={groupModalColor}
                              onChange={(event) => setGroupModalColor(event.target.value)}
                            />
                          </div>
                        </label>
                      ) : null}
                      {groupModalItemFill === "filled" ? (
                        <div className="timeline-group-setting-row">
                          <span className="form-label">Fill Transparency</span>
                          <div className="timeline-group-slider-row">
                            <input
                              className="form-range"
                              type="range"
                              min="0"
                              max="100"
                              step="1"
                              value={groupModalItemFillTransparency}
                              onChange={(event) => setGroupModalItemFillTransparency(Number(event.target.value))}
                            />
                            <span className="timeline-group-slider-value">{groupModalItemFillTransparency}%</span>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="timeline-group-item-preview-card" aria-label="Timeline item preview">
                      <span className="form-label">Preview</span>
                      <div
                        className="timeline-group-item-preview-row"
                        style={{
                          backgroundColor:
                            groupModalBackgroundTransparency >= 100
                              ? "transparent"
                              : translucentTimelineFill(
                                  normalizeTimelineColor(groupModalBackgroundColor, TIMELINE_DEFAULT_GROUP_BACKGROUND),
                                  timelineAlphaHexFromPercent(100 - groupModalBackgroundTransparency),
                                ),
                        }}
                      >
                        <div className="timeline-group-item-preview-label">
                          {groupModalName.trim() || "Group"}
                        </div>
                        <div className="timeline-group-item-preview-track">
                          <div
                            className={`timeline-group-item-preview timeline-group-item-preview--${groupModalTextSize}`}
                            style={{
                              backgroundColor:
                                groupModalItemFill === "outline"
                                  ? "transparent"
                                  : translucentTimelineFill(
                                      normalizeTimelineColor(groupModalColor, TIMELINE_DEFAULT_GROUP_COLOR),
                                      timelineAlphaHexFromPercent(100 - groupModalItemFillTransparency),
                                    ),
                              borderColor: normalizeTimelineColor(groupModalOutlineColor, TIMELINE_DEFAULT_GROUP_COLOR),
                            }}
                          >
                            Timeline Item
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
              </div>
            )}
            {groupModalError ? <div className="form-error">{groupModalError}</div> : null}
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button type="button" className="btn" onClick={() => setGroupModalDraft(null)} disabled={groupModalSaving}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" onClick={submitTimelineGroupModal} disabled={groupModalSaving || !groupModalName.trim()}>
              {groupModalSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </SettingsModal>
      ) : null}
      {timelineGroupContextMenu ? (() => {
        const contextGroup = timelineGroupById.get(timelineGroupContextMenu.groupId);
        if (!contextGroup) return null;
        return (
          <div
            className="context-menu"
            style={{ left: timelineGroupContextMenu.x, top: timelineGroupContextMenu.y }}
            role="menu"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="context-menu-item"
              onClick={() => {
                setTimelineGroupContextMenu(null);
                openTimelineGroupModal(contextGroup);
              }}
            >
              Edit
            </button>
            <button
              type="button"
              className="context-menu-item context-menu-item--danger"
              disabled={deletingGroupId === contextGroup.id}
              onClick={() => {
                setTimelineGroupContextMenu(null);
                void deleteTimelineGroup(contextGroup);
              }}
            >
              {deletingGroupId === contextGroup.id ? "Deleting..." : "Delete"}
            </button>
          </div>
        );
      })() : null}
      {timelineBackgroundContextMenu ? (
        <div
          className="context-menu"
          style={{ left: timelineBackgroundContextMenu.x, top: timelineBackgroundContextMenu.y, minWidth: 176 }}
          role="menu"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className={canManageSources ? "context-menu-item" : "context-menu-item context-menu-item--disabled"}
            disabled={!canManageSources}
            onClick={() => handleCreateTimelineSource(timelineBackgroundContextMenu.timelineStart)}
          >
            New source
          </button>
          <button
            type="button"
            className={canManageSources ? "context-menu-item" : "context-menu-item context-menu-item--disabled"}
            disabled={!canManageSources}
            onClick={() => handleCreateTimelineObject(timelineBackgroundContextMenu.timelineStart)}
          >
            New object
          </button>
          <button
            type="button"
            className={canManageSources ? "context-menu-item" : "context-menu-item context-menu-item--disabled"}
            disabled={!canManageSources}
            onClick={() => handleCreateTimelineRelationship(timelineBackgroundContextMenu.timelineStart)}
          >
            New relationship
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => {
              setTimelineBackgroundContextMenu(null);
              setTimelineAppearanceModalOpen(true);
            }}
          >
            Edit timeline
          </button>
        </div>
      ) : null}
      {timelineAppearanceModalOpen ? (
        <SettingsModal
          title="Edit Timeline"
          onClose={() => setTimelineAppearanceModalOpen(false)}
        >
          <div className="form app-settings-modal-body">
            <div className="timeline-appearance-grid">
              <label className="form-label">
                Background
                <div className="timeline-group-color-control">
                  <input
                    className="form-input form-input--color"
                    type="color"
                    value={timelineAppearance.backgroundColor}
                    onChange={(event) => {
                      const next = { ...timelineAppearance, backgroundColor: event.target.value };
                      setTimelineAppearance(next);
                      saveTimelineAppearanceSettings(next);
                    }}
                  />
                  <input
                    className="form-input timeline-group-color-text"
                    value={timelineAppearance.backgroundColor}
                    onChange={(event) => {
                      const next = { ...timelineAppearance, backgroundColor: event.target.value };
                      setTimelineAppearance(next);
                      if (/^#[0-9a-f]{6}$/i.test(event.target.value.trim())) saveTimelineAppearanceSettings(next);
                    }}
                  />
                </div>
              </label>
              <label className="form-label">
                Lines
                <div className="timeline-group-color-control">
                  <input
                    className="form-input form-input--color"
                    type="color"
                    value={timelineAppearance.lineColor}
                    onChange={(event) => {
                      const next = { ...timelineAppearance, lineColor: event.target.value };
                      setTimelineAppearance(next);
                      saveTimelineAppearanceSettings(next);
                    }}
                  />
                  <input
                    className="form-input timeline-group-color-text"
                    value={timelineAppearance.lineColor}
                    onChange={(event) => {
                      const next = { ...timelineAppearance, lineColor: event.target.value };
                      setTimelineAppearance(next);
                      if (/^#[0-9a-f]{6}$/i.test(event.target.value.trim())) saveTimelineAppearanceSettings(next);
                    }}
                  />
                </div>
              </label>
            </div>
            <div className="timeline-group-setting-row">
              <span className="form-label">Font size</span>
              <div className="text-size-controls timeline-group-setting-control" aria-label="Timeline font size">
                <button
                  type="button"
                  className="text-size-control-btn text-size-control-btn--decrease"
                  onClick={() => adjustTimelineAppearanceFontSize(-1)}
                  disabled={timelineAppearance.fontSize === "small"}
                  aria-label="Decrease timeline font size"
                >
                  A
                </button>
                <span className="text-size-control-value" aria-live="polite">
                  {TIMELINE_GROUP_TEXT_SIZE_OPTIONS.find((option) => option.value === timelineAppearance.fontSize)?.label ?? "Regular"}
                </span>
                <button
                  type="button"
                  className="text-size-control-btn text-size-control-btn--increase"
                  onClick={() => adjustTimelineAppearanceFontSize(1)}
                  disabled={timelineAppearance.fontSize === "large"}
                  aria-label="Increase timeline font size"
                >
                  A
                </button>
              </div>
            </div>
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setTimelineAppearance(DEFAULT_TIMELINE_APPEARANCE);
                saveTimelineAppearanceSettings(DEFAULT_TIMELINE_APPEARANCE);
              }}
            >
              Reset
            </button>
            <button type="button" className="btn btn--primary" onClick={() => setTimelineAppearanceModalOpen(false)}>
              Done
            </button>
          </div>
        </SettingsModal>
      ) : null}
    </section>
  );
}
