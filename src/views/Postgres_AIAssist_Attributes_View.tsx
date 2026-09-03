import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HelpIcon, PlusIcon } from "../components/AppIcons";
import { parseProcessedTranscriptSegments } from "../components/ProcessedTranscriptView";
import { SettingsModal } from "../components/SettingsModal";
import { useI18n } from "../i18n/provider";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import { buildLlmInvokeRequestFields } from "../lib/llmRuntime";
import {
  createPostgresAiAnalysis,
  deletePostgresAiAnalysis,
  getPostgresInstallationSettings,
  getPostgresProjectAiAssistSettings,
  listPostgresAiAnalyses,
  listPostgresObjectAttributeDefinitions,
  listPostgresObjects,
  listPostgresRelationshipAttributeDefinitions,
  listPostgresRelationships,
  listPostgresSourceAttributeDefinitions,
  listPostgresSourceAttributeValues,
  listPostgresSources,
  savePostgresObject,
  savePostgresRelationship,
  savePostgresSourceAttribute,
  type PostgresAiAnalysis,
  type PostgresObject,
  type PostgresObjectAttributeDefinition,
  type PostgresRelationship,
  type PostgresRelationshipAttributeDefinition,
  type PostgresSource,
  type PostgresSourceAttributeDefinition,
  type PostgresSourceAttributeValue,
} from "../lib/postgres";

type AttributeKind = "source" | "object" | "relationship";
type AttributeSortColumn = "name" | "type" | "missing";
type SortDirection = "asc" | "desc";

type AttributeSuggestionRow = {
  ownerId: string;
  ownerName: string;
  suggestedValue: string;
  evidenceText: string;
  reviewStatus?: "pending" | "edited" | "accepted" | "rejected";
  previousValue?: string;
};

type AttributeSuggestionSnapshot = {
  reportType: "ai-attribute-suggestions";
  kind: AttributeKind;
  selectedAttributeId: string | null;
  suggestionRowsByAttribute: Record<string, AttributeSuggestionRow[]>;
  suggestionModelByAttribute: Record<string, string>;
};

type AttributeOwnerRow = {
  ownerId: string;
  ownerName: string;
  typeLabel: string;
  currentValue: string;
  content: string;
};

type EvidenceModalState = {
  sourceName: string;
  suggestedValue: string;
  evidenceText: string;
  beforeText: string;
  afterText: string;
};

type EditSuggestionModalState = {
  row: AttributeSuggestionRow;
  value: string;
};

type OllamaAttributeSuggestionProgressEvent = {
  runId: string;
  itemId: string;
  itemName: string;
  suggestedValue: string;
  evidenceText: string;
  completedItems: number;
  totalItems: number;
  model: string;
  baseUrl: string;
};

type AttributeSuggestionRunState = {
  runId: string;
  attributeId: string;
  completedItems: number;
  totalItems: number;
};

function formatDate(value: string): string {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatAttributeTypeLabel(value: string): string {
  switch (value) {
    case "text":
      return "Text";
    case "number":
      return "Number";
    case "datetime":
      return "Date/time";
    case "categorical":
      return "Categorical";
    default:
      return value;
  }
}

function parseSnapshot(row: PostgresAiAnalysis): AttributeSuggestionSnapshot | null {
  try {
    const parsed = JSON.parse(row.snapshotJson || "{}");
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Record<string, unknown>;
    if (
      candidate.reportType !== "ai-attribute-suggestions"
      || (candidate.kind !== "source" && candidate.kind !== "object" && candidate.kind !== "relationship")
    ) return null;
    const suggestionRowsByAttribute =
      candidate.suggestionRowsByAttribute && typeof candidate.suggestionRowsByAttribute === "object"
        ? candidate.suggestionRowsByAttribute as Record<string, AttributeSuggestionRow[]>
        : {};
    const suggestionModelByAttribute =
      candidate.suggestionModelByAttribute && typeof candidate.suggestionModelByAttribute === "object"
        ? candidate.suggestionModelByAttribute as Record<string, string>
        : {};
    return {
      reportType: "ai-attribute-suggestions",
      kind: candidate.kind,
      selectedAttributeId: typeof candidate.selectedAttributeId === "string" ? candidate.selectedAttributeId : null,
      suggestionRowsByAttribute,
      suggestionModelByAttribute,
    };
  } catch {
    return null;
  }
}

function findEvidenceRangeInText(content: string, evidenceText: string): { startOffset: number; endOffset: number } | null {
  const trimmedEvidence = evidenceText.trim();
  if (!content || !trimmedEvidence) return null;
  const exactIndex = content.indexOf(trimmedEvidence);
  if (exactIndex >= 0) {
    return { startOffset: exactIndex, endOffset: exactIndex + trimmedEvidence.length };
  }

  const normalizeWithMap = (value: string) => {
    let normalized = "";
    const indexMap: number[] = [];
    let inWhitespace = false;
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      if (/\s/.test(char)) {
        if (!inWhitespace) {
          normalized += " ";
          indexMap.push(index);
          inWhitespace = true;
        }
      } else {
        normalized += char;
        indexMap.push(index);
        inWhitespace = false;
      }
    }
    return { normalized: normalized.trim(), indexMap };
  };

  const normalizedContent = normalizeWithMap(content);
  const normalizedEvidence = trimmedEvidence.replace(/\s+/g, " ").trim();
  const normalizedIndex = normalizedContent.normalized.indexOf(normalizedEvidence);
  if (normalizedIndex < 0) return null;
  const startOffset = normalizedContent.indexMap[normalizedIndex];
  const endMapIndex = normalizedIndex + normalizedEvidence.length - 1;
  const endOffset = typeof normalizedContent.indexMap[endMapIndex] === "number"
    ? normalizedContent.indexMap[endMapIndex] + 1
    : NaN;
  if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset) || endOffset <= startOffset) return null;
  return { startOffset, endOffset };
}

function renderMissingAttributeValue() {
  return <span className="users-td--muted">N/A</span>;
}

function joinContentLines(lines: Array<string | null | undefined>): string {
  return lines.map((line) => line?.trim() ?? "").filter(Boolean).join("\n");
}

function formatAttributeValuesForPrompt(values: Array<{ attributeDefinitionId: string; attributeName: string; value: string }>, excludedAttributeId?: string) {
  return values
    .filter((value) => value.attributeDefinitionId !== excludedAttributeId && value.value.trim() && value.attributeName.trim())
    .map((value) => `${value.attributeName}: ${value.value.trim()}`)
    .join("\n");
}

function formatLinkedSourcesForPrompt(linkedSources: PostgresSource[]): string {
  return linkedSources
    .filter((source) => getSourceAiTextContent(source).trim())
    .map((source) => {
      const name = source.title || source.originalFileName || "Untitled source";
      return `Source: ${name}\n${getSourceAiTextContent(source).trim()}`;
    })
    .join("\n\n");
}

function normalizeSourceKind(value: string | null | undefined): string {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/_/g, " ");
  if (normalized === "processed transcript") return "transcript";
  return normalized;
}

function formatSourceKindLabel(value: string | null | undefined): string {
  const normalized = normalizeSourceKind(value);
  if (!normalized) return "Source";
  if (normalized === "pdf") return "PDF";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function getSourceAiTextContent(source: PostgresSource): string {
  const textContent = source.textContent.trim();
  if (textContent) return textContent;
  if (normalizeSourceKind(source.sourceKind) !== "transcript") return "";
  return parseProcessedTranscriptSegments(source.structuredContentJson)
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

function sourceHasAiAttributeContent(source: PostgresSource): boolean {
  const kind = normalizeSourceKind(source.sourceKind);
  return (kind === "text" || kind === "transcript") && getSourceAiTextContent(source).trim().length > 0;
}

function sourceMatchesAttributeKinds(source: PostgresSource, definition: PostgresSourceAttributeDefinition): boolean {
  const allowedKinds = definition.sourceKinds.map(normalizeSourceKind).filter(Boolean);
  if (allowedKinds.length === 0) return true;
  return allowedKinds.includes(normalizeSourceKind(source.sourceKind));
}

export function PostgresAIAssistAttributesView({
  projectId,
  canUseAiAttributeTools,
}: {
  projectId: string;
  canUseAiAttributeTools: boolean;
}) {
  const { t } = useI18n();
  const [sources, setSources] = useState<PostgresSource[]>([]);
  const [objects, setObjects] = useState<PostgresObject[]>([]);
  const [relationships, setRelationships] = useState<PostgresRelationship[]>([]);
  const [definitions, setDefinitions] = useState<PostgresSourceAttributeDefinition[]>([]);
  const [objectDefinitions, setObjectDefinitions] = useState<PostgresObjectAttributeDefinition[]>([]);
  const [relationshipDefinitions, setRelationshipDefinitions] = useState<PostgresRelationshipAttributeDefinition[]>([]);
  const [values, setValues] = useState<PostgresSourceAttributeValue[]>([]);
  const [savedRuns, setSavedRuns] = useState<PostgresAiAnalysis[]>([]);
  const [attributeKind, setAttributeKind] = useState<AttributeKind>("source");
  const [selectedAttributeId, setSelectedAttributeId] = useState<string | null>(null);
  const [attributeSortColumn, setAttributeSortColumn] = useState<AttributeSortColumn>("name");
  const [attributeSortDirection, setAttributeSortDirection] = useState<SortDirection>("asc");
  const [loadedRun, setLoadedRun] = useState<PostgresAiAnalysis | null>(null);
  const [suggestionRowsByAttribute, setSuggestionRowsByAttribute] = useState<Record<string, AttributeSuggestionRow[]>>({});
  const [suggestionModelByAttribute, setSuggestionModelByAttribute] = useState<Record<string, string>>({});
  const [selectedOwnerIdsByAttribute, setSelectedOwnerIdsByAttribute] = useState<Record<string, string[]>>({});
  const [suggestionRunState, setSuggestionRunState] = useState<AttributeSuggestionRunState | null>(null);
  const [suggestionBusy, setSuggestionBusy] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [acceptingOwnerId, setAcceptingOwnerId] = useState<string | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [aiAssistEnabled, setAiAssistEnabled] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [evidenceModal, setEvidenceModal] = useState<EvidenceModalState | null>(null);
  const [editSuggestionModal, setEditSuggestionModal] = useState<EditSuggestionModalState | null>(null);
  const [savedRunContextMenu, setSavedRunContextMenu] = useState<{ x: number; y: number; runId: string } | null>(null);
  const suggestionRunRef = useRef<AttributeSuggestionRunState | null>(null);
  const savedRunContextMenuRef = useRef<HTMLDivElement | null>(null);
  const savedRunContextMenuStyle = useViewportContextMenuStyle(savedRunContextMenu, savedRunContextMenuRef);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [
        sourceRows,
        objectRows,
        relationshipRows,
        definitionRows,
        objectDefinitionRows,
        relationshipDefinitionRows,
        valueRows,
        analysisRows,
        aiSettings,
      ] = await Promise.all([
        listPostgresSources(projectId),
        listPostgresObjects(projectId),
        listPostgresRelationships(projectId),
        listPostgresSourceAttributeDefinitions(projectId),
        listPostgresObjectAttributeDefinitions(projectId),
        listPostgresRelationshipAttributeDefinitions(projectId),
        listPostgresSourceAttributeValues(projectId),
        listPostgresAiAnalyses(projectId),
        getPostgresProjectAiAssistSettings(projectId),
      ]);
      const aiAttributeSources = sourceRows.filter(sourceHasAiAttributeContent);
      const sortedDefinitions = [...definitionRows].sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
      const sortedObjectDefinitions = [...objectDefinitionRows].sort((a, b) => {
        const typeCompare = a.objectType.localeCompare(b.objectType, undefined, { sensitivity: "base" });
        if (typeCompare !== 0) return typeCompare;
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
      const sortedRelationshipDefinitions = [...relationshipDefinitionRows].sort((a, b) => {
        const typeCompare = a.relationshipType.localeCompare(b.relationshipType, undefined, { sensitivity: "base" });
        if (typeCompare !== 0) return typeCompare;
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
      setSources(aiAttributeSources);
      setObjects(objectRows);
      setRelationships(relationshipRows);
      setDefinitions(sortedDefinitions);
      setObjectDefinitions(sortedObjectDefinitions);
      setRelationshipDefinitions(sortedRelationshipDefinitions);
      setValues(valueRows);
      setSavedRuns(analysisRows.filter((row) => row.analysisType === "attribute_suggestions"));
      setAiAssistEnabled(aiSettings.enabled);
      setSelectedAttributeId((current) => {
        if (current && sortedDefinitions.some((definition) => definition.id === current)) return current;
        return sortedDefinitions[0]?.id ?? null;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load AI attribute suggestions.");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    suggestionRunRef.current = suggestionRunState;
  }, [suggestionRunState]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (savedRunContextMenuRef.current && !savedRunContextMenuRef.current.contains(event.target as Node)) {
        setSavedRunContextMenu(null);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSavedRunContextMenu(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen<OllamaAttributeSuggestionProgressEvent>("attribute-suggestion-progress", (event) => {
      const payload = event.payload;
      const activeRun = suggestionRunRef.current;
      if (!activeRun || payload.runId !== activeRun.runId) return;
      setSuggestionRowsByAttribute((current) => {
        const currentRows = current[activeRun.attributeId] ?? [];
        const nextRow = {
          ownerId: payload.itemId,
          ownerName: payload.itemName,
          suggestedValue: payload.suggestedValue,
          evidenceText: payload.evidenceText,
        };
        const existingIndex = currentRows.findIndex((row) => row.ownerId === nextRow.ownerId);
        const nextRows = existingIndex >= 0
          ? currentRows.map((row, index) => index === existingIndex ? nextRow : row)
          : [...currentRows, nextRow];
        return { ...current, [activeRun.attributeId]: nextRows };
      });
      setSuggestionModelByAttribute((current) => ({ ...current, [activeRun.attributeId]: payload.model }));
      setSuggestionRunState({
        ...activeRun,
        completedItems: payload.completedItems,
        totalItems: payload.totalItems,
      });
      if (payload.completedItems >= payload.totalItems) {
        setSuggestionBusy(false);
        setSuggestionRunState(null);
      }
    }).then((dispose) => {
      unlisten = dispose;
    }).catch((listenError) => {
      console.error("Could not listen for attribute suggestion progress:", listenError);
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const selectedSourceAttribute = useMemo(
    () => definitions.find((definition) => definition.id === selectedAttributeId) ?? null,
    [definitions, selectedAttributeId],
  );

  const selectedObjectAttribute = useMemo(
    () => objectDefinitions.find((definition) => definition.id === selectedAttributeId) ?? null,
    [objectDefinitions, selectedAttributeId],
  );

  const selectedRelationshipAttribute = useMemo(
    () => relationshipDefinitions.find((definition) => definition.id === selectedAttributeId) ?? null,
    [relationshipDefinitions, selectedAttributeId],
  );

  const selectedAttribute = attributeKind === "source"
    ? selectedSourceAttribute
    : attributeKind === "object"
      ? selectedObjectAttribute
      : selectedRelationshipAttribute;

  const valuesBySourceAndAttribute = useMemo(() => {
    const map = new Map<string, PostgresSourceAttributeValue>();
    for (const value of values) {
      map.set(`${value.sourceId}:${value.attributeDefinitionId}`, value);
    }
    return map;
  }, [values]);

  const sourcesById = useMemo(() => {
    const map = new Map<string, PostgresSource>();
    for (const source of sources) {
      map.set(source.id, source);
    }
    return map;
  }, [sources]);

  const linkedTextSourcesByObjectId = useMemo(() => {
    const map = new Map<string, PostgresSource[]>();
    const addLinkedSource = (objectId: string, sourceId: string) => {
      const source = sourcesById.get(sourceId);
      if (!source || !sourceHasAiAttributeContent(source)) return;
      const current = map.get(objectId) ?? [];
      if (!current.some((item) => item.id === source.id)) {
        map.set(objectId, [...current, source]);
      }
    };
    for (const relationship of relationships) {
      if (relationship.fromEntityType === "object" && relationship.toEntityType === "source") {
        addLinkedSource(relationship.fromEntityId, relationship.toEntityId);
      }
      if (relationship.fromEntityType === "source" && relationship.toEntityType === "object") {
        addLinkedSource(relationship.toEntityId, relationship.fromEntityId);
      }
    }
    return map;
  }, [relationships, sourcesById]);

  const attributeOwnerRows = useMemo<AttributeOwnerRow[]>(() => {
    if (attributeKind === "source") {
      if (!selectedSourceAttribute) return [];
      return sources.filter((source) => sourceMatchesAttributeKinds(source, selectedSourceAttribute)).map((source) => {
        const valueRow = valuesBySourceAndAttribute.get(`${source.id}:${selectedSourceAttribute.id}`);
        return {
          ownerId: source.id,
          ownerName: source.title || source.originalFileName || "Untitled source",
          typeLabel: formatSourceKindLabel(source.sourceKind),
          currentValue: valueRow?.value ?? "",
          content: getSourceAiTextContent(source),
        };
      });
    }
    if (attributeKind === "object") {
      if (!selectedObjectAttribute) return [];
      return objects
        .filter((object) => object.objectTypeId === selectedObjectAttribute.objectTypeId)
        .map((object) => {
          const valueRow = object.attributeValues.find((value) => value.attributeDefinitionId === selectedObjectAttribute.id);
          const existingAttributes = formatAttributeValuesForPrompt(object.attributeValues, selectedObjectAttribute.id);
          const linkedSourceContent = formatLinkedSourcesForPrompt(linkedTextSourcesByObjectId.get(object.id) ?? []);
          return {
          ownerId: object.id,
          ownerName: object.title || "Untitled object",
          typeLabel: object.objectType || "Object",
          currentValue: valueRow?.value ?? "",
            content: joinContentLines([
              `Object: ${object.title || "Untitled object"}`,
              `Type: ${object.objectType}`,
              object.description ? `Description: ${object.description}` : "",
              object.eventStartAt ? `Event start: ${object.eventStartAt}` : "",
              object.eventEndAt ? `Event end: ${object.eventEndAt}` : "",
              existingAttributes ? `Existing attributes:\n${existingAttributes}` : "",
              linkedSourceContent ? `Directly linked text sources:\n${linkedSourceContent}` : "",
            ]),
          };
        });
    }
    if (!selectedRelationshipAttribute) return [];
    return relationships
      .filter((relationship) => relationship.relationshipTypeId === selectedRelationshipAttribute.relationshipTypeId)
      .map((relationship) => {
        const valueRow = relationship.attributeValues.find((value) => value.attributeDefinitionId === selectedRelationshipAttribute.id);
        const existingAttributes = formatAttributeValuesForPrompt(relationship.attributeValues, selectedRelationshipAttribute.id);
        const linkedSources = new Map<string, PostgresSource>();
        const addSourceById = (sourceId: string) => {
          const source = sourcesById.get(sourceId);
          if (source && sourceHasAiAttributeContent(source)) linkedSources.set(source.id, source);
        };
        const addSourcesLinkedToObject = (objectId: string) => {
          for (const source of linkedTextSourcesByObjectId.get(objectId) ?? []) {
            linkedSources.set(source.id, source);
          }
        };
        if (relationship.fromEntityType === "source") addSourceById(relationship.fromEntityId);
        if (relationship.toEntityType === "source") addSourceById(relationship.toEntityId);
        if (relationship.fromEntityType === "object") addSourcesLinkedToObject(relationship.fromEntityId);
        if (relationship.toEntityType === "object") addSourcesLinkedToObject(relationship.toEntityId);
        const linkedSourceContent = formatLinkedSourcesForPrompt([...linkedSources.values()]);
        return {
          ownerId: relationship.id,
          ownerName: `${relationship.fromEntityName || "Unknown"} -> ${relationship.toEntityName || "Unknown"}`,
          typeLabel: relationship.relationshipType || "Relationship",
          currentValue: valueRow?.value ?? "",
          content: joinContentLines([
            `Relationship: ${relationship.fromEntityName || "Unknown"} -> ${relationship.toEntityName || "Unknown"}`,
            `Type: ${relationship.relationshipType}`,
            relationship.description ? `Description: ${relationship.description}` : "",
            existingAttributes ? `Existing attributes:\n${existingAttributes}` : "",
            linkedSourceContent ? `Directly linked text sources:\n${linkedSourceContent}` : "",
          ]),
        };
      });
  }, [
    attributeKind,
    linkedTextSourcesByObjectId,
    objects,
    relationships,
    selectedObjectAttribute,
    selectedRelationshipAttribute,
    selectedSourceAttribute,
    sources,
    sourcesById,
    valuesBySourceAndAttribute,
  ]);

  const selectedOwnerIds = selectedAttributeId ? (selectedOwnerIdsByAttribute[selectedAttributeId] ?? []) : [];
  const selectedOwnerIdSet = useMemo(() => new Set(selectedOwnerIds), [selectedOwnerIds]);
  const selectedOwnerRows = useMemo(
    () => attributeOwnerRows.filter((row) => selectedOwnerIdSet.has(row.ownerId)),
    [attributeOwnerRows, selectedOwnerIdSet],
  );
  const allOwnersSelected = attributeOwnerRows.length > 0 && selectedOwnerIds.length === attributeOwnerRows.length;

  useEffect(() => {
    if (!selectedAttributeId) return;
    setSelectedOwnerIdsByAttribute((current) => {
      if (Object.prototype.hasOwnProperty.call(current, selectedAttributeId)) {
        const availableIds = new Set(attributeOwnerRows.map((row) => row.ownerId));
        const nextIds = (current[selectedAttributeId] ?? []).filter((id) => availableIds.has(id));
        if (nextIds.length === (current[selectedAttributeId] ?? []).length) return current;
        return { ...current, [selectedAttributeId]: nextIds };
      }
      return { ...current, [selectedAttributeId]: attributeOwnerRows.map((row) => row.ownerId) };
    });
  }, [attributeOwnerRows, selectedAttributeId]);

  const attributeTableRows = useMemo(() => {
    if (attributeKind === "source") {
      return definitions.map((definition) => {
        const eligibleSources = sources.filter((source) => sourceMatchesAttributeKinds(source, definition));
        const eligibleSourceIds = new Set(eligibleSources.map((source) => source.id));
        const filledCount = values.filter((value) =>
          value.attributeDefinitionId === definition.id
          && eligibleSourceIds.has(value.sourceId)
          && value.value.trim()
        ).length;
        const totalCount = eligibleSources.length;
        return {
          id: definition.id,
          name: definition.name,
          typeLabel: formatAttributeTypeLabel(definition.dataType),
          contextLabel: "Source",
          missingCount: Math.max(0, totalCount - filledCount),
          totalCount,
        };
      });
    }
    if (attributeKind === "object") {
      return objectDefinitions.map((definition) => {
        const eligibleObjects = objects.filter((object) => object.objectTypeId === definition.objectTypeId);
        const filledCount = eligibleObjects.filter((object) =>
          object.attributeValues.some((value) => value.attributeDefinitionId === definition.id && value.value.trim()),
        ).length;
        const totalCount = eligibleObjects.length;
        return {
          id: definition.id,
          name: definition.name,
          typeLabel: formatAttributeTypeLabel(definition.dataType),
          contextLabel: definition.objectType,
          missingCount: Math.max(0, totalCount - filledCount),
          totalCount,
        };
      });
    }
    return relationshipDefinitions.map((definition) => {
      const eligibleRelationships = relationships.filter((relationship) => relationship.relationshipTypeId === definition.relationshipTypeId);
      const filledCount = eligibleRelationships.filter((relationship) =>
        relationship.attributeValues.some((value) => value.attributeDefinitionId === definition.id && value.value.trim()),
      ).length;
      const totalCount = eligibleRelationships.length;
      return {
        id: definition.id,
        name: definition.name,
        typeLabel: formatAttributeTypeLabel(definition.dataType),
        contextLabel: definition.relationshipType,
        missingCount: Math.max(0, totalCount - filledCount),
        totalCount,
      };
    });
  }, [attributeKind, definitions, objectDefinitions, objects, relationshipDefinitions, relationships, sources, values]);

  const sortedAttributeTableRows = useMemo(() => {
    return [...attributeTableRows].sort((a, b) => {
      let cmp = 0;
      if (attributeSortColumn === "missing") {
        cmp = a.missingCount - b.missingCount;
      } else if (attributeSortColumn === "type") {
        cmp = a.typeLabel.localeCompare(b.typeLabel, undefined, { sensitivity: "base", numeric: true });
      } else {
        cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
      }
      if (cmp === 0) {
        cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
      }
      if (cmp === 0) {
        cmp = a.contextLabel.localeCompare(b.contextLabel, undefined, { sensitivity: "base", numeric: true });
      }
      return attributeSortDirection === "asc" ? cmp : -cmp;
    });
  }, [attributeSortColumn, attributeSortDirection, attributeTableRows]);

  const suggestionRows = selectedAttributeId ? (suggestionRowsByAttribute[selectedAttributeId] ?? []) : [];
  const suggestionModel = selectedAttributeId ? (suggestionModelByAttribute[selectedAttributeId] ?? "") : "";
  const hasGeneratedSuggestions = Object.values(suggestionRowsByAttribute).some((rows) => rows.length > 0);

  const snapshot = useMemo<AttributeSuggestionSnapshot>(() => ({
    reportType: "ai-attribute-suggestions",
    kind: attributeKind,
    selectedAttributeId,
    suggestionRowsByAttribute,
    suggestionModelByAttribute,
  }), [attributeKind, selectedAttributeId, suggestionModelByAttribute, suggestionRowsByAttribute]);

  function clearSuggestionDraft() {
    setLoadedRun(null);
    setSuggestionRowsByAttribute({});
    setSuggestionModelByAttribute({});
    setSuggestionRunState(null);
    setSaveName("");
  }

  function handleSelectAttribute(attributeId: string) {
    if (attributeId !== selectedAttributeId) {
      clearSuggestionDraft();
    }
    setSelectedAttributeId(attributeId);
    setError("");
  }

  function handleToggleOwner(ownerId: string) {
    if (!selectedAttributeId) return;
    clearSuggestionDraft();
    setSelectedOwnerIdsByAttribute((current) => {
      const currentIds = current[selectedAttributeId] ?? attributeOwnerRows.map((row) => row.ownerId);
      const nextIds = currentIds.includes(ownerId)
        ? currentIds.filter((id) => id !== ownerId)
        : [...currentIds, ownerId];
      return { ...current, [selectedAttributeId]: nextIds };
    });
  }

  function handleSortAttributes(column: AttributeSortColumn) {
    if (column === attributeSortColumn) {
      setAttributeSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setAttributeSortColumn(column);
    setAttributeSortDirection("asc");
  }

  function handleSelectAttributeKind(nextKind: AttributeKind) {
    if (nextKind !== attributeKind) {
      clearSuggestionDraft();
    } else {
      setLoadedRun(null);
    }
    setAttributeKind(nextKind);
    const nextSelectedId = nextKind === "source"
      ? definitions[0]?.id
      : nextKind === "object"
        ? objectDefinitions[0]?.id
        : relationshipDefinitions[0]?.id;
    setSelectedAttributeId(nextSelectedId ?? null);
    setError("");
  }

  function handleOpenSavedRun(row: PostgresAiAnalysis) {
    setSavedRunContextMenu(null);
    const parsed = parseSnapshot(row);
    if (!parsed) {
      setError("The saved attribute suggestion run could not be read.");
      return;
    }
    setLoadedRun(row);
    setAttributeKind(parsed.kind);
    setSelectedAttributeId(parsed.selectedAttributeId);
    setSuggestionRowsByAttribute(parsed.suggestionRowsByAttribute);
    setSuggestionModelByAttribute(parsed.suggestionModelByAttribute);
    setError("");
  }

  async function handleGenerateSuggestions() {
    if (!selectedAttribute || selectedOwnerRows.length === 0 || suggestionBusy) return;
    setSuggestionBusy(true);
    setError("");
    setLoadedRun(null);
    const runId = `${selectedAttribute.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setSuggestionRowsByAttribute({ [selectedAttribute.id]: [] });
    setSuggestionModelByAttribute({ [selectedAttribute.id]: "" });
    setSuggestionRunState({
      runId,
      attributeId: selectedAttribute.id,
      completedItems: 0,
      totalItems: selectedOwnerRows.length,
    });

    try {
      const settings = await getPostgresInstallationSettings();
      const runtime = buildLlmInvokeRequestFields(settings.llm);
      const response = await invoke<{
        model: string;
        baseUrl: string;
        suggestions: Array<{ itemId: string; itemName: string; suggestedValue: string; evidenceText: string }>;
      }>("generate_attribute_value_suggestions_with_ollama", {
        request: {
          runId,
          attributeName: selectedAttribute.name,
          attributeDataType: selectedAttribute.dataType,
          attributeDescription: selectedAttribute.description,
          attributeOptions: selectedAttribute.options,
          items: selectedOwnerRows.map((row) => ({
            id: row.ownerId,
            name: row.ownerName,
            content: row.content,
          })),
          ...runtime,
        },
      });
      const nextRows = response.suggestions.map((suggestion) => ({
        ownerId: suggestion.itemId,
        ownerName: suggestion.itemName,
        suggestedValue: suggestion.suggestedValue,
        evidenceText: suggestion.evidenceText,
      }));
      setSuggestionRowsByAttribute((current) => ({ ...current, [selectedAttribute.id]: nextRows }));
      setSuggestionModelByAttribute((current) => ({ ...current, [selectedAttribute.id]: response.model }));
      setSuggestionRunState(null);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Could not generate attribute suggestions.");
      setSuggestionRunState(null);
    } finally {
      setSuggestionBusy(false);
    }
  }

  function updateSuggestionRow(ownerId: string, updater: (row: AttributeSuggestionRow) => AttributeSuggestionRow) {
    if (!selectedAttributeId) return;
    setSuggestionRowsByAttribute((current) => ({
      ...current,
      [selectedAttributeId]: (current[selectedAttributeId] ?? []).map((row) => row.ownerId === ownerId ? updater(row) : row),
    }));
  }

  function buildAttributeValueChangeMetadata(action: string, row: AttributeSuggestionRow) {
    return {
      aiAssistRelated: true,
      aiAssistAction: action,
      metadata: {
        attributeKind,
        attributeId: selectedAttribute?.id ?? "",
        attributeName: selectedAttribute?.name ?? "",
        ownerId: row.ownerId,
        ownerName: row.ownerName,
        suggestedValue: row.suggestedValue,
        evidenceText: row.evidenceText,
      },
    };
  }

  async function saveAttributeValueForOwner(ownerId: string, value: string, action?: string, row?: AttributeSuggestionRow) {
    const attributeValueChange = action && row ? buildAttributeValueChangeMetadata(action, row) : undefined;
      if (attributeKind === "source" && selectedSourceAttribute) {
        const result = await savePostgresSourceAttribute({
          projectId,
          attributeDefinitionId: selectedSourceAttribute.id,
          name: selectedSourceAttribute.name,
          dataType: selectedSourceAttribute.dataType,
          description: selectedSourceAttribute.description,
          options: selectedSourceAttribute.options,
        values: [{ sourceId: ownerId, value }],
        attributeValueChange,
        });
        setValues((current) => [
          ...current.filter((item) => item.attributeDefinitionId !== selectedSourceAttribute.id || item.sourceId !== ownerId),
          ...result.values.filter((item) => item.sourceId === ownerId),
        ]);
      } else if (attributeKind === "object" && selectedObjectAttribute) {
      const object = objects.find((item) => item.id === ownerId);
        if (!object) throw new Error("The object for this suggestion could not be found.");
        const updated = await savePostgresObject({
          projectId,
          objectId: object.id,
          objectTypeId: object.objectTypeId,
          title: object.title,
          description: object.description,
          shapeOverride: object.shapeOverride,
          colorOverride: object.colorOverride,
          outlineColorOverride: object.outlineColorOverride,
          fillOverride: object.fillOverride,
          imageStoragePath: object.imageStoragePath,
          eventStartAt: object.eventStartAt,
          eventEndAt: object.eventEndAt,
          eventTimePrecision: object.eventTimePrecision,
          eventTimezone: object.eventTimezone,
          eventIsInstant: object.eventIsInstant,
          attributeValues: [
            ...object.attributeValues
              .filter((value) => value.attributeDefinitionId !== selectedObjectAttribute.id)
              .map((value) => ({ attributeDefinitionId: value.attributeDefinitionId, value: value.value })),
          { attributeDefinitionId: selectedObjectAttribute.id, value },
          ],
          attributeValueChange,
        });
        setObjects((current) => current.map((item) => item.id === updated.id ? updated : item));
      } else if (attributeKind === "relationship" && selectedRelationshipAttribute) {
      const relationship = relationships.find((item) => item.id === ownerId);
        if (!relationship) throw new Error("The relationship for this suggestion could not be found.");
        const updated = await savePostgresRelationship({
          projectId,
          relationshipId: relationship.id,
          fromEntityType: relationship.fromEntityType,
          fromEntityId: relationship.fromEntityId,
          toEntityType: relationship.toEntityType,
          toEntityId: relationship.toEntityId,
          relationshipTypeId: relationship.relationshipTypeId,
          description: relationship.description,
          lineShapeOverride: relationship.lineShapeOverride,
          lineWeightOverride: relationship.lineWeightOverride,
          arrowheadOverride: relationship.arrowheadOverride,
          colorOverride: relationship.colorOverride,
          attributeValues: [
            ...relationship.attributeValues
              .filter((value) => value.attributeDefinitionId !== selectedRelationshipAttribute.id)
              .map((value) => ({ attributeDefinitionId: value.attributeDefinitionId, value: value.value })),
          { attributeDefinitionId: selectedRelationshipAttribute.id, value },
          ],
          attributeValueChange,
        });
        setRelationships((current) => current.map((item) => item.id === updated.id ? updated : item));
      }
  }

  async function handleAcceptSuggestion(row: AttributeSuggestionRow, valueOverride?: string) {
    if (!selectedAttribute) return;
    const valueToAccept = (valueOverride ?? row.suggestedValue).trim();
    if (!valueToAccept) return;
    if (
      selectedAttribute.dataType === "categorical"
      && !selectedAttribute.options.includes(valueToAccept)
    ) {
      setError(t("aiAssist.attributes.landing.valueNotAllowed", { value: valueToAccept, attribute: selectedAttribute.name }));
      return;
    }
    const ownerRow = attributeOwnerRows.find((item) => item.ownerId === row.ownerId);
    setAcceptingOwnerId(row.ownerId);
    setError("");
    try {
      const action = row.reviewStatus === "edited" || valueOverride != null ? "edit_accept" : "accept";
      await saveAttributeValueForOwner(row.ownerId, valueToAccept, action, row);
      updateSuggestionRow(row.ownerId, (current) => ({
        ...current,
        suggestedValue: valueToAccept,
        reviewStatus: "accepted",
        previousValue: ownerRow?.currentValue ?? current.previousValue ?? "",
      }));
      setEditSuggestionModal(null);
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : "Could not accept the attribute suggestion.");
    } finally {
      setAcceptingOwnerId(null);
    }
  }

  function handleRejectSuggestion(row: AttributeSuggestionRow) {
    updateSuggestionRow(row.ownerId, (current) => ({ ...current, reviewStatus: "rejected" }));
  }

  function handleUndoSuggestion(row: AttributeSuggestionRow) {
    if (row.reviewStatus === "accepted") {
      setAcceptingOwnerId(row.ownerId);
      setError("");
      saveAttributeValueForOwner(row.ownerId, row.previousValue ?? "", "undo_accept", row)
        .then(() => {
          updateSuggestionRow(row.ownerId, (current) => ({ ...current, reviewStatus: current.suggestedValue === row.suggestedValue ? "pending" : "edited" }));
        })
        .catch((undoError) => {
          setError(undoError instanceof Error ? undoError.message : "Could not undo the accepted attribute suggestion.");
        })
        .finally(() => setAcceptingOwnerId(null));
      return;
    }
    updateSuggestionRow(row.ownerId, (current) => ({ ...current, reviewStatus: current.suggestedValue === row.suggestedValue ? "pending" : "edited" }));
  }

  function handleSaveEditedSuggestion() {
    if (!editSuggestionModal) return;
    const nextValue = editSuggestionModal.value.trim();
    if (!nextValue) {
      setError("Enter a suggested value before saving.");
      return;
    }
    updateSuggestionRow(editSuggestionModal.row.ownerId, (current) => ({
      ...current,
      suggestedValue: nextValue,
      reviewStatus: "edited",
    }));
    setEditSuggestionModal(null);
  }

  function handleOpenEvidence(row: AttributeSuggestionRow) {
    const owner = attributeOwnerRows.find((item) => item.ownerId === row.ownerId);
    if (!owner) {
      setError("The row for this suggestion could not be found.");
      return;
    }
    const range = findEvidenceRangeInText(owner.content, row.evidenceText);
    const contextPadding = 420;
    const beforeText = range
      ? owner.content.slice(Math.max(0, range.startOffset - contextPadding), range.startOffset)
      : "";
    const evidenceText = range
      ? owner.content.slice(range.startOffset, range.endOffset)
      : row.evidenceText.trim();
    const afterText = range
      ? owner.content.slice(range.endOffset, Math.min(owner.content.length, range.endOffset + contextPadding))
      : "";
    setEvidenceModal({
      sourceName: owner.ownerName,
      suggestedValue: row.suggestedValue,
      evidenceText,
      beforeText,
      afterText,
    });
  }

  async function handleSaveSuggestions() {
    if (!selectedAttribute || !hasGeneratedSuggestions || suggestionBusy) return;
    const title = saveName.trim() || `${selectedAttribute.name} Suggestions`;
    setSaving(true);
    setError("");
    try {
      const saved = await createPostgresAiAnalysis({
        projectId,
        analysisType: "attribute_suggestions",
        title,
        snapshotJson: JSON.stringify(snapshot),
        resultJson: JSON.stringify(snapshot.suggestionRowsByAttribute),
        contentText: Object.values(snapshot.suggestionRowsByAttribute)
          .flat()
          .map((row) => `${row.ownerName}: ${row.suggestedValue}`)
          .join("\n"),
        model: suggestionModel,
        baseUrl: "",
      });
      setLoadedRun(saved);
      setSavedRuns((current) => [saved, ...current.filter((row) => row.id !== saved.id)]);
      setSaveName("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save attribute suggestions.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSavedRun(row: PostgresAiAnalysis) {
    setSavedRunContextMenu(null);
    setDeleteBusyId(row.id);
    setError("");
    try {
      await deletePostgresAiAnalysis(projectId, row.id);
      setSavedRuns((current) => current.filter((item) => item.id !== row.id));
      if (loadedRun?.id === row.id) setLoadedRun(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("aiAssist.attributes.landing.couldNotDeleteSavedSuggestions"));
    } finally {
      setDeleteBusyId(null);
    }
  }

  if (!canUseAiAttributeTools) {
    return <div className="view"><div className="empty-state"><p>{t("aiAssist.attributes.noPermission")}</p></div></div>;
  }

  if (!aiAssistEnabled) {
    return <div className="view"><div className="empty-state"><p>{t("aiAssist.attributes.enableAiAssist")}</p></div></div>;
  }

  return (
    <div className="view users-view ai-attribute-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>{t("aiAssist.attributes.title")}</h1>
          <button type="button" className="users-help-icon-btn" onClick={() => setHelpOpen(true)} title={t("aiAssist.attributes.about")} aria-label={t("aiAssist.attributes.about")}>
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
      </header>

      {helpOpen ? (
        <SettingsModal title={t("aiAssist.attributes.helpTitle")} onClose={() => setHelpOpen(false)} modalClassName="modal--help">
          <div className="app-settings-modal-body">
            <p className="users-guide-copy">{t("aiAssist.attributes.helpBody")}</p>
          </div>
        </SettingsModal>
      ) : null}

      {evidenceModal ? (
        <SettingsModal
          title={t("aiAssist.attributes.modals.evidence.title")}
          subtitle={evidenceModal.sourceName}
          onClose={() => setEvidenceModal(null)}
          modalClassName="modal--wide ai-attribute-evidence-modal"
        >
          <div className="app-settings-modal-body">
            <div className="ai-attribute-evidence-summary">
              <span>{t("aiAssist.attributes.labels.suggestedValueLower")}</span>
              <strong>{evidenceModal.suggestedValue}</strong>
            </div>
            <div className="ai-attribute-evidence-text">
              {evidenceModal.beforeText ? <span>{evidenceModal.beforeText}</span> : null}
              <mark>{evidenceModal.evidenceText}</mark>
              {evidenceModal.afterText ? <span>{evidenceModal.afterText}</span> : null}
            </div>
          </div>
        </SettingsModal>
      ) : null}

      {editSuggestionModal ? (
        <SettingsModal
          title={t("aiAssist.attributes.modals.evidence.editTitle")}
          subtitle={editSuggestionModal.row.ownerName}
          onClose={() => setEditSuggestionModal(null)}
          modalClassName="modal--wide ai-attribute-edit-modal"
        >
          <div className="app-settings-modal-body">
            <label className="form-label" htmlFor="edit-attribute-suggestion-value">{t("aiAssist.attributes.labels.suggestedValueLower")}</label>
            <textarea
              id="edit-attribute-suggestion-value"
              className="form-control ai-attribute-edit-textarea"
              value={editSuggestionModal.value}
              onChange={(event) => setEditSuggestionModal((current) => current ? { ...current, value: event.target.value } : current)}
              rows={4}
            />
            {editSuggestionModal.row.evidenceText.trim() ? (
              <div className="ai-attribute-evidence-summary">
                <span>{t("aiAssist.attributes.labels.evidence")}</span>
                <strong>{editSuggestionModal.row.evidenceText}</strong>
              </div>
            ) : null}
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button type="button" className="btn btn--primary" onClick={handleSaveEditedSuggestion}>
              {t("aiAssist.attributes.actions.saveEdit")}
            </button>
          </div>
        </SettingsModal>
      ) : null}

      {error ? <p className="users-error">{error}</p> : null}
      {loading ? <p className="users-guide-copy">{t("aiAssist.attributes.loadingAttributes")}</p> : null}

      <div className="annotate-layout ai-assisted-coding-annotate-layout ai-assisted-coding-analyze-layout">
        <div className="annotate-left">
          <div className="annotate-card">
            <div className="annotate-card-header">
              <span className="annotate-card-title">{t("aiAssist.attributes.title")}</span>
            </div>
            <div className="segmented-control ai-attribute-kind-tabs" role="tablist" aria-label={t("aiAssist.attributes.labels.attributeTarget")}>
              <button
                type="button"
                role="tab"
                aria-selected={attributeKind === "source"}
                className={attributeKind === "source" ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                onClick={() => handleSelectAttributeKind("source")}
              >
                {t("aiAssist.attributes.labels.source")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={attributeKind === "object"}
                className={attributeKind === "object" ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                onClick={() => handleSelectAttributeKind("object")}
              >
                {t("aiAssist.attributes.labels.object")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={attributeKind === "relationship"}
                className={attributeKind === "relationship" ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                onClick={() => handleSelectAttributeKind("relationship")}
              >
                {t("aiAssist.attributes.labels.relationship")}
              </button>
            </div>
            <div className="users-table-wrap ai-attribute-picker-table-wrap">
              <table className="users-table ai-attribute-picker-table">
                <thead>
                  <tr>
                    {([
                      { key: "name", label: t("aiAssist.attributes.landing.table.name"), className: "ai-attribute-picker-name-col" },
                      { key: "type", label: t("aiAssist.chat.type"), className: "ai-attribute-picker-type-col" },
                      { key: "missing", label: t("aiAssist.attributes.labels.missing"), className: "ai-attribute-picker-missing-col" },
                    ] as Array<{ key: AttributeSortColumn; label: string; className: string }>).map((column) => (
                      <th
                        key={column.key}
                        className={`users-th ${column.className}${attributeSortColumn === column.key ? " users-th--sorted" : ""}`}
                        onClick={() => handleSortAttributes(column.key)}
                        role="button"
                        tabIndex={0}
                        aria-sort={attributeSortColumn === column.key ? (attributeSortDirection === "asc" ? "ascending" : "descending") : "none"}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleSortAttributes(column.key);
                          }
                        }}
                      >
                        {column.label}
                        <span className="users-sort-icon">
                          {attributeSortColumn === column.key ? (attributeSortDirection === "asc" ? " ↑" : " ↓") : " ↕"}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedAttributeTableRows.length === 0 ? (
                    <tr>
                      <td className="users-td users-td--muted" colSpan={3}>
                        {t("aiAssist.attributes.landing.noAttributesYet", { kind: attributeKind })}
                      </td>
                    </tr>
                  ) : sortedAttributeTableRows.map((row) => (
                    <tr
                      key={row.id}
                      className="users-row ai-attribute-picker-row"
                      onClick={() => handleSelectAttribute(row.id)}
                      style={{
                        background: selectedAttributeId === row.id ? "rgba(53, 80, 112, 0.10)" : undefined,
                      }}
                    >
                      <td
                        className="users-td users-td--name"
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleSelectAttribute(row.id);
                          }
                        }}
                      >
                        <span className="ai-attribute-picker-name">{row.name}</span>
                        {attributeKind !== "source" ? <span className="ai-attribute-picker-context">{row.contextLabel}</span> : null}
                      </td>
                      <td className="users-td">{row.typeLabel}</td>
                      <td className="users-td ai-attribute-picker-missing-col">
                        <strong>{row.missingCount}</strong>
                        <span className="users-td--muted"> / {row.totalCount}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="annotate-card" style={{ marginTop: 16 }}>
            <div className="annotate-card-header">
              <span className="annotate-card-title">{t("aiAssist.attributes.landing.savedSuggestions")}</span>
              <button
                type="button"
                className="btn btn--small ai-saved-new-icon-button"
                aria-label={t("aiAssist.attributes.actions.newSuggestion")}
                title={t("aiAssist.attributes.actions.newSuggestion")}
                onClick={clearSuggestionDraft}
              >
                <PlusIcon className="ai-saved-new-icon" />
              </button>
            </div>
            <div className="ai-chat-list">
              {savedRuns.length === 0 ? (
                <div className="empty-state ai-chat-empty-state"><p>{t("aiAssist.attributes.landing.noSavedSuggestions")}</p></div>
              ) : savedRuns.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`ai-chat-list-item${loadedRun?.id === row.id ? " ai-chat-list-item--active" : ""}`}
                  onClick={() => handleOpenSavedRun(row)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setSavedRunContextMenu({ x: event.clientX, y: event.clientY, runId: row.id });
                  }}
                >
                  <strong>{row.title}</strong>
                  <span>{row.createdByName || "Unknown"} · {formatDate(row.createdAt)}</span>
                </button>
              ))}
            </div>
          </div>
          {savedRunContextMenu ? (
            <div ref={savedRunContextMenuRef} className="context-menu" style={savedRunContextMenuStyle}>
              <button
                type="button"
                className="context-menu-item context-menu-item--danger"
                onClick={() => {
                  const row = savedRuns.find((run) => run.id === savedRunContextMenu.runId);
                  if (row) void handleDeleteSavedRun(row);
                }}
                disabled={deleteBusyId === savedRunContextMenu.runId}
              >
                {t("aiAssist.attributes.actions.deleteSuggestions")}
              </button>
            </div>
          ) : null}
        </div>

        <div className="annotate-main">
          <div className="annotate-card annotate-card--grow">
            <div className="annotate-card-header">
              <span className="annotate-card-title" />
              <div className="users-header-actions ai-attribute-save-actions">
                <input
                  className="form-input"
                  value={saveName}
                  onChange={(event) => setSaveName(event.target.value)}
                  placeholder={selectedAttribute ? t("aiAssist.attributes.labels.defaultSuggestionTitle", { attribute: selectedAttribute.name }) : t("aiAssist.attributes.labels.suggestionRunName")}
                  disabled={!hasGeneratedSuggestions || saving}
                />
                <button
                  type="button"
                  className="btn btn--small btn--primary"
                  onClick={() => void handleSaveSuggestions()}
                  disabled={!hasGeneratedSuggestions || saving || suggestionBusy}
                >
                  {saving ? t("aiAssist.attributes.statuses.saving") : loadedRun ? t("aiAssist.attributes.actions.saveCopy") : t("common.save")}
                </button>
              </div>
            </div>

            {selectedAttribute ? (
              <div className="ai-attribute-selected-summary">
                <div className="ai-attribute-selected-summary-header">
                  <div className="ai-attribute-selected-summary-main">
                    <div className="ai-attribute-selected-summary-badges">
                      <span className="ai-attribute-selected-summary-kind">
                        {attributeKind === "source" ? t("aiAssist.attributes.labels.sourceAttribute") : attributeKind === "object" ? t("aiAssist.attributes.labels.objectAttribute") : t("aiAssist.attributes.labels.relationshipAttribute")}
                      </span>
                      <span className="ai-attribute-selected-summary-type">{formatAttributeTypeLabel(selectedAttribute.dataType)}</span>
                    </div>
                    <strong>{selectedAttribute.name}</strong>
                  </div>
                  <button
                    type="button"
                    className="btn btn--small btn--primary"
                    onClick={() => void handleGenerateSuggestions()}
                    disabled={!canUseAiAttributeTools || selectedOwnerRows.length === 0 || suggestionBusy}
                  >
                    {suggestionBusy ? t("aiAssist.attributes.statuses.running") : t("aiAssist.attributes.actions.run")}
                  </button>
                </div>
                {selectedAttribute.description.trim() ? (
                  <p className="backup-field-hint ai-attribute-selected-summary-description">{selectedAttribute.description}</p>
                ) : null}
              </div>
            ) : null}

            {suggestionBusy && suggestionRunState ? (
              <div className="ai-segments-search-state" style={{ margin: 14 }}>
                <div className="ai-segments-progress" aria-hidden="true">
                  <span className="ai-segments-progress-bar" />
                </div>
                <div className="ai-segments-search-copy">
                  {t("aiAssist.attributes.landing.ownerProgress", {
                    kind: attributeKind === "source" ? t("aiAssist.attributes.labels.source") : attributeKind === "object" ? t("aiAssist.attributes.labels.object") : t("aiAssist.attributes.labels.relationship"),
                    completed: suggestionRunState.completedItems,
                    total: suggestionRunState.totalItems,
                  })}
                </div>
              </div>
            ) : null}

            {!selectedAttribute ? (
              <div className="ai-attribute-placeholder"><p>{t("aiAssist.attributes.landing.selectAttribute")}</p></div>
            ) : attributeOwnerRows.length === 0 ? (
              <div className="ai-attribute-placeholder"><p>{t("aiAssist.attributes.landing.noAvailableOwners", { kind: attributeKind })}</p></div>
            ) : (
              <div className="ai-attribute-table-wrap">
                {suggestionModel ? <p className="backup-field-hint ai-attribute-suggestion-meta">{t("aiAssist.attributes.landing.generatedWith", { model: suggestionModel })}</p> : null}
                <div className="ai-attribute-table-selection-toolbar">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      if (!selectedAttributeId) return;
                      clearSuggestionDraft();
                      setSelectedOwnerIdsByAttribute((current) => ({
                        ...current,
                        [selectedAttributeId]: attributeOwnerRows.map((row) => row.ownerId),
                      }));
                    }}
                    disabled={allOwnersSelected}
                  >
                    {t("aiAssist.attributes.actions.all")}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      if (!selectedAttributeId) return;
                      clearSuggestionDraft();
                      setSelectedOwnerIdsByAttribute((current) => ({
                        ...current,
                        [selectedAttributeId]: [],
                      }));
                    }}
                    disabled={selectedOwnerIds.length === 0}
                  >
                    {t("aiAssist.attributes.actions.clear")}
                  </button>
                </div>
                <table className="users-table ai-attribute-table">
                  <thead>
                    <tr>
                      <th className="users-th ai-attribute-table-select-col" aria-label={t("common.include")} />
                      <th className="users-th ai-attribute-table-owner-col">
                        {attributeKind === "source" ? t("aiAssist.attributes.labels.source") : attributeKind === "object" ? t("aiAssist.attributes.labels.object") : t("aiAssist.attributes.labels.relationship")}
                      </th>
                      <th className="users-th ai-attribute-table-type-col">{t("aiAssist.chat.type")}</th>
                      <th className="users-th ai-attribute-table-value-col">{t("aiAssist.attributes.labels.currentValue")}</th>
                      <th className="users-th ai-attribute-table-value-col">{t("aiAssist.attributes.labels.suggestedValue")}</th>
                      <th className="users-th ai-attribute-table-action-col">{t("aiAssist.attributes.labels.review")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attributeOwnerRows.map((ownerRow) => {
                      const suggestionRow = suggestionRows.find((row) => row.ownerId === ownerRow.ownerId) ?? null;
                      return (
                        <tr key={ownerRow.ownerId} className={selectedOwnerIdSet.has(ownerRow.ownerId) ? "" : "ai-attribute-table-row--unselected"}>
                          <td className="users-td ai-attribute-table-select-cell">
                            <input
                              type="checkbox"
                              checked={selectedOwnerIdSet.has(ownerRow.ownerId)}
                              onChange={() => handleToggleOwner(ownerRow.ownerId)}
                              aria-label={`Include ${ownerRow.ownerName} in suggestion generation`}
                            />
                          </td>
                          <td className="users-td users-td--name ai-attribute-table-owner-cell">{ownerRow.ownerName}</td>
                          <td className="users-td ai-attribute-table-type-cell">{ownerRow.typeLabel}</td>
                          <td className="users-td ai-attribute-table-value-cell">{ownerRow.currentValue ? ownerRow.currentValue : renderMissingAttributeValue()}</td>
                          <td className="users-td ai-attribute-table-value-cell">
                            {suggestionRow?.suggestedValue.trim() ? (
                              <button type="button" className="ai-attribute-suggestion-link" onClick={() => handleOpenEvidence(suggestionRow)}>
                                {suggestionRow.suggestedValue}
                              </button>
                            ) : renderMissingAttributeValue()}
                          </td>
                          <td className="users-td ai-attribute-table-action-cell">
                            {suggestionRow?.suggestedValue.trim() ? (
                              <div className="ai-attribute-review-actions">
                                {suggestionRow.reviewStatus === "accepted" ? (
                                  <>
                                    <span className="ai-attribute-review-status ai-attribute-review-status--accepted">{t("aiAssist.attributes.statuses.accepted")}</span>
                                    <button
                                      type="button"
                                      className="btn btn--small"
                                      onClick={() => handleUndoSuggestion(suggestionRow)}
                                      disabled={acceptingOwnerId === suggestionRow.ownerId}
                                    >
                                      {t("aiAssist.attributes.actions.undo")}
                                    </button>
                                  </>
                                ) : suggestionRow.reviewStatus === "rejected" ? (
                                  <>
                                    <span className="ai-attribute-review-status ai-attribute-review-status--rejected">{t("aiAssist.attributes.statuses.rejected")}</span>
                                    <button
                                      type="button"
                                      className="btn btn--small"
                                      onClick={() => handleUndoSuggestion(suggestionRow)}
                                    >
                                      {t("aiAssist.attributes.actions.undo")}
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    {suggestionRow.reviewStatus === "edited" ? (
                                      <span className="ai-attribute-review-status ai-attribute-review-status--edited">{t("aiAssist.attributes.statuses.edited")}</span>
                                    ) : null}
                                    <button
                                      type="button"
                                      className="btn btn--small btn--primary"
                                      onClick={() => void handleAcceptSuggestion(suggestionRow)}
                                      disabled={acceptingOwnerId === suggestionRow.ownerId}
                                    >
                                      {acceptingOwnerId === suggestionRow.ownerId ? t("aiAssist.attributes.statuses.saving") : t("aiAssist.attributes.actions.accept")}
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn--small"
                                      onClick={() => setEditSuggestionModal({ row: suggestionRow, value: suggestionRow.suggestedValue })}
                                      disabled={acceptingOwnerId === suggestionRow.ownerId}
                                    >
                                      {t("aiAssist.attributes.actions.edit")}
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn--small"
                                      onClick={() => handleRejectSuggestion(suggestionRow)}
                                      disabled={acceptingOwnerId === suggestionRow.ownerId}
                                    >
                                      {t("aiAssist.attributes.actions.reject")}
                                    </button>
                                  </>
                                )}
                              </div>
                            ) : renderMissingAttributeValue()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {suggestionRows.length === 0 ? (
                  <div className="ai-attribute-placeholder" style={{ marginTop: 16 }}>
                    <p>{t("aiAssist.attributes.landing.selectRowsThenGenerate")}</p>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
