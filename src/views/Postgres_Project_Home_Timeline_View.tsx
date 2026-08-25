import { useEffect, useMemo, useRef, useState } from "react";
import "vis-timeline/styles/vis-timeline-graph2d.min.css";
import { CodeIcon, ObjectIcon, PlusIcon, RelationshipIcon, SourceIcon } from "../components/AppIcons";
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
} from "../lib/postgres";

type PostgresProjectTimelineItemKind = "source" | "object" | "relationship";

type PostgresProjectTimelineEntry = {
  id: string;
  kind: PostgresProjectTimelineItemKind;
  title: string;
  typeLabel: string;
  itemType: string;
  groupLabel: string;
  start: Date;
  end: Date | null;
  fillColor: string;
  outlineColor: string;
};

const TIMELINE_SOURCE_DEFAULT_FILL = "#e0f2f1";
const TIMELINE_SOURCE_DEFAULT_OUTLINE = "#0f766e";
const TIMELINE_OBJECT_DEFAULT_FILL = "#e8edf3";
const TIMELINE_OBJECT_DEFAULT_OUTLINE = "#355070";
const TIMELINE_RELATIONSHIP_DEFAULT_FILL = "#ede9fe";
const TIMELINE_RELATIONSHIP_DEFAULT_OUTLINE = "#7c3aed";

function formatPostgresSourceKindLabel(kind: string): string {
  return kind ? kind.split(/[_\s-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") : "Source";
}

function normalizeTimelineColor(value: string | null | undefined, fallback: string): string {
  const normalized = (value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : fallback;
}

function translucentTimelineFill(hexColor: string, alphaHex = "24"): string {
  return /^#[0-9a-f]{6}$/i.test(hexColor) ? `${hexColor}${alphaHex}` : hexColor;
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

function timelineItemStyle(fillColor: string, outlineColor: string): string {
  return `background-color: ${fillColor}; border-color: ${outlineColor};`;
}

function escapeTimelineHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseTimelineDate(value: string | null | undefined): Date | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) return null;
  return new Date(timestamp);
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
  canManageSources,
  canManageAnnotations,
  onCreateSource,
  onCreateObject,
  onCreateRelationship,
  onCreateCode,
  onTimelineItemContextMenu,
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
  canManageSources: boolean;
  canManageAnnotations: boolean;
  onCreateSource: () => void;
  onCreateObject: () => void;
  onCreateRelationship: () => void;
  onCreateCode: () => void;
  onTimelineItemContextMenu?: (context: {
    kind: PostgresProjectTimelineItemKind;
    id: string;
    clientX: number;
    clientY: number;
  }) => void;
}) {
  const timelineContainerRef = useRef<HTMLDivElement | null>(null);
  const createControlRef = useRef<HTMLDivElement | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
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
      const groupDefinition = timelineRoleDefinition(definitions, "timeline_group");
      const typeDefinition = timelineRoleDefinition(definitions, "timeline_item_type");
      const end = endDefinition ? parseTimelineDate(sourceValueByKey.get(`${source.id}:${endDefinition.id}`)) : null;
      const sourceTypeLabel = formatPostgresSourceKindLabel(source.sourceKind);
      const colors = resolveSourceTimelineColors(source.sourceKind, sourceTypeSettings);
      entries.push({
        id: `source:${source.id}`,
        kind: "source",
        title: labelDefinition ? sourceValueByKey.get(`${source.id}:${labelDefinition.id}`)?.trim() || source.title : source.title,
        typeLabel: sourceTypeLabel,
        itemType: typeDefinition ? sourceValueByKey.get(`${source.id}:${typeDefinition.id}`)?.trim() || "" : "",
        groupLabel: groupDefinition ? sourceValueByKey.get(`${source.id}:${groupDefinition.id}`)?.trim() || sourceTypeLabel : sourceTypeLabel,
        start,
        end: end && end >= start ? end : null,
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
      const groupDefinition = timelineRoleDefinition(definitions, "timeline_group");
      const typeDefinition = timelineRoleDefinition(definitions, "timeline_item_type");
      const end = endDefinition ? parseTimelineDate(valueByDefinitionId.get(endDefinition.id)) : null;
      const colors = resolveObjectTimelineColors(object, objectType);
      entries.push({
        id: `object:${object.id}`,
        kind: "object",
        title: labelDefinition ? valueByDefinitionId.get(labelDefinition.id)?.trim() || object.title : object.title,
        typeLabel: object.objectType || "Object",
        itemType: typeDefinition ? valueByDefinitionId.get(typeDefinition.id)?.trim() || "" : "",
        groupLabel: groupDefinition ? valueByDefinitionId.get(groupDefinition.id)?.trim() || object.objectType || "Object" : object.objectType || "Object",
        start,
        end: end && end >= start ? end : null,
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
      const groupDefinition = timelineRoleDefinition(definitions, "timeline_group");
      const typeDefinition = timelineRoleDefinition(definitions, "timeline_item_type");
      const end = endDefinition ? parseTimelineDate(valueByDefinitionId.get(endDefinition.id)) : null;
      const fallbackTitle = relationship.relationshipType || `${relationship.fromEntityName} - ${relationship.toEntityName}`;
      const colors = resolveRelationshipTimelineColors(relationship, relationshipType);
      entries.push({
        id: `relationship:${relationship.id}`,
        kind: "relationship",
        title: labelDefinition ? valueByDefinitionId.get(labelDefinition.id)?.trim() || fallbackTitle : fallbackTitle,
        typeLabel: relationship.relationshipType || "Relationship",
        itemType: typeDefinition ? valueByDefinitionId.get(typeDefinition.id)?.trim() || "" : "",
        groupLabel: groupDefinition ? valueByDefinitionId.get(groupDefinition.id)?.trim() || relationship.relationshipType || "Relationship" : relationship.relationshipType || "Relationship",
        start,
        end: end && end >= start ? end : null,
        ...colors,
      });
    }

    return entries.sort((left, right) => left.start.getTime() - right.start.getTime() || left.title.localeCompare(right.title, undefined, { sensitivity: "base" }));
  }, [objects, objectAttributeDefinitions, objectTypes, relationshipAttributeDefinitions, relationships, relationshipTypes, sourceAttributeDefinitions, sourceAttributeValues, sourceTypeSettings, sources]);

  useEffect(() => {
    const container = timelineContainerRef.current;
    if (!container || timelineEntries.length === 0) return;
    let cancelled = false;
    let timeline: {
      destroy: () => void;
      fit: (options?: { animation?: boolean }) => void;
      on?: (eventName: string, callback: (properties: {
        event?: Event;
        item?: string | number | null;
      }) => void) => void;
    } | null = null;
    void Promise.all([
      import("vis-data"),
      import("vis-timeline/standalone"),
    ]).then(([visData, visTimeline]) => {
      if (cancelled) return;
      const groupLabels = Array.from(new Set(timelineEntries.map((entry) => `${entry.kind}:${entry.groupLabel}`)));
      const groups = new visData.DataSet(groupLabels.map((id) => {
        const [kind, ...labelParts] = id.split(":");
        const label = labelParts.join(":");
        return {
          id,
          content: `<span class="project-timeline-group project-timeline-group--${kind}">${label}</span>`,
        };
      }));
      const items = new visData.DataSet(timelineEntries.map((entry) => {
        const group = `${entry.kind}:${entry.groupLabel}`;
        const itemType = entry.itemType ? ` <span class="project-timeline-item-type">${escapeTimelineHtml(entry.itemType)}</span>` : "";
        return {
          id: entry.id,
          group,
          content: `<span>${escapeTimelineHtml(entry.title)}</span>${itemType}`,
          title: `${entry.title}\n${entry.kind}: ${entry.typeLabel}`,
          start: entry.start,
          ...(entry.end ? { end: entry.end, type: "range" } : {}),
          className: `project-timeline-item project-timeline-item--${entry.kind}`,
          style: timelineItemStyle(entry.fillColor, entry.outlineColor),
        };
      }));
      timeline = new visTimeline.Timeline(container, items, groups, {
        stack: true,
        horizontalScroll: true,
        zoomKey: "ctrlKey",
        orientation: "top",
        margin: { item: 10, axis: 12 },
        maxHeight: "100%",
        minHeight: "100%",
        tooltip: { followMouse: true },
      });
      timeline.on?.("contextmenu", (properties) => {
        const rawItemId = properties.item == null ? "" : String(properties.item);
        if (!rawItemId) return;
        const nativeEvent = properties.event;
        nativeEvent?.preventDefault();
        nativeEvent?.stopPropagation();
        const [kind, ...idParts] = rawItemId.split(":");
        const id = idParts.join(":");
        if (
          !id
          || (kind !== "source" && kind !== "object" && kind !== "relationship")
          || !(nativeEvent instanceof MouseEvent)
        ) {
          return;
        }
        onTimelineItemContextMenu?.({
          kind,
          id,
          clientX: nativeEvent.clientX,
          clientY: nativeEvent.clientY,
        });
      });
      timeline.fit({ animation: false });
    });
    return () => {
      cancelled = true;
      timeline?.destroy();
    };
  }, [onTimelineItemContextMenu, timelineEntries]);

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

  const mappedDefinitionsCount = sourceAttributeDefinitions.filter((definition) => definition.timelineRole).length
    + objectAttributeDefinitions.filter((definition) => definition.timelineRole).length
    + relationshipAttributeDefinitions.filter((definition) => definition.timelineRole).length;
  const groupCount = new Set(timelineEntries.map((entry) => `${entry.kind}:${entry.groupLabel}`)).size;

  return (
    <section className="project-home-timeline-card">
      {timelineEntries.length === 0 ? (
        <div className="project-home-timeline-empty">
          <div className="project-home-canvas-create-control project-home-timeline-create-control" ref={createControlRef}>
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
              <div className="project-home-canvas-create-menu">
                <button
                  type="button"
                  className="btn project-home-canvas-create-action"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onCreateSource();
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
                    onCreateObject();
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
                    onCreateRelationship();
                  }}
                  disabled={!canManageSources}
                  aria-label="Add relationship"
                  title="Relationship"
                >
                  <RelationshipIcon className="project-home-canvas-create-action-icon" />
                </button>
                <button
                  type="button"
                  className="btn project-home-canvas-create-action"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onCreateCode();
                  }}
                  disabled={!canManageAnnotations}
                  aria-label="Add code"
                  title="Code"
                >
                  <CodeIcon className="project-home-canvas-create-action-icon" />
                </button>
              </div>
            ) : null}
          </div>
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
          <div className="project-home-timeline-summary">
            <span>{timelineEntries.length} timeline item{timelineEntries.length === 1 ? "" : "s"}</span>
            <span>{groupCount} group{groupCount === 1 ? "" : "s"}</span>
          </div>
          <div ref={timelineContainerRef} className="project-home-timeline-canvas" />
        </>
      )}
    </section>
  );
}
