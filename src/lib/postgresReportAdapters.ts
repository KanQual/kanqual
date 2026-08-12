import type { Annotation, Code, Document as ProjectDocument, ProjectLogEntry } from "../types";
import {
  listPostgresObjectAttributeDefinitions,
  listPostgresProjectLog,
  listPostgresProjectUsers,
  listPostgresRelationships,
  type PostgresAnnotationSummary,
  type PostgresCode,
  type PostgresObject,
  type PostgresObjectAttributeDefinition,
  type PostgresObjectAttributeValue,
  type PostgresProjectLogEntry,
  type PostgresProjectUser,
  type PostgresRelationship,
  type PostgresSource,
  type PostgresSourceAttributeDefinition,
  type PostgresSourceAttributeValue,
} from "./postgres";
import { loadPostgresProjectWorkspaceSnapshot } from "./postgresProjectWorkspace";

export type ReportCaseItem = { id: string; name: string; objectType?: string };
export type ReportRelationshipItem = {
  id: string;
  relationshipType: string;
  object1Id: string;
  object1Name: string;
  object1Type?: "object" | "source";
  object2Id: string;
  object2Name: string;
  object2Type?: "object" | "source";
};
export type ReportUserItem = { id: string; appUserId?: string; name: string };
export type ReportAttributeItem = { id: string; name: string; dataType: string };
export type ReportAttributeValueItem = { id: string; ownerId: string; attributeId: string; value: string };
export type ReportAnnotation = Annotation & {
  sourceKind: string;
  timeStartMs: number | null;
  timeEndMs: number | null;
  imageRegion: PostgresAnnotationSummary["imageRegion"];
};

export type PostgresReportBuilderData = {
  cases: ReportCaseItem[];
  relationships: ReportRelationshipItem[];
  users: ReportUserItem[];
  documents: ProjectDocument[];
  codes: Code[];
  annotations: ReportAnnotation[];
  caseDocumentLinks: Array<{ caseId: string; documentId: string }>;
  caseAttributeItems: ReportAttributeItem[];
  documentAttributeItems: ReportAttributeItem[];
  caseAttributeValues: ReportAttributeValueItem[];
  documentAttributeValues: ReportAttributeValueItem[];
  projectLogEntries: ProjectLogEntry[];
};

function mapObjectToCaseItem(object: PostgresObject): ReportCaseItem {
  return {
    id: object.id,
    objectType: object.objectType,
    name: object.title || object.objectType || "Untitled object",
  };
}

function mapRelationship(
  relationship: PostgresRelationship,
  objectsById: Map<string, PostgresObject>,
): ReportRelationshipItem {
  const fromEntityType = relationship.fromEntityType || "object";
  const toEntityType = relationship.toEntityType || "object";
  const fromEntityId = relationship.fromEntityId || relationship.fromObjectId;
  const toEntityId = relationship.toEntityId || relationship.toObjectId;
  const fromName = relationship.fromEntityName || objectsById.get(fromEntityId)?.title || "Unknown endpoint";
  const toName = relationship.toEntityName || objectsById.get(toEntityId)?.title || "Unknown endpoint";
  const typeName = relationship.relationshipType || "Relationship";
  return {
    id: relationship.id,
    relationshipType: typeName,
    object1Id: fromEntityId,
    object1Name: fromName,
    object1Type: fromEntityType,
    object2Id: toEntityId,
    object2Name: toName,
    object2Type: toEntityType,
  };
}

function mapSourceToDocument(source: PostgresSource): ProjectDocument {
  return {
    id: source.id,
    projectId: source.projectId,
    name: source.title,
    type: source.sourceKind,
    filePath: source.storagePath,
    content: source.textContent,
    structuredContentJson: source.structuredContentJson,
    importedAt: source.createdAt,
  };
}

function mapCode(code: PostgresCode): Code {
  return {
    id: code.id,
    projectId: code.projectId,
    label: code.label,
    color: code.color,
    description: code.description,
    shortcut: code.shortcut || undefined,
    parentId: code.parentCodeId || undefined,
  };
}

function mapAnnotation(annotation: PostgresAnnotationSummary): ReportAnnotation {
  return {
    id: annotation.id,
    documentId: annotation.sourceId,
    codeId: annotation.primaryCodeId,
    startOffset: annotation.startOffset ?? 0,
    endOffset: annotation.endOffset ?? 0,
    sourceKind: annotation.sourceKind,
    timeStartMs: annotation.timeStartMs,
    timeEndMs: annotation.timeEndMs,
    imageRegion: annotation.imageRegion,
    quote: annotation.quote,
    note: annotation.note,
    createdAt: annotation.createdAt,
    createdBy: annotation.createdByName,
    createdById: annotation.createdByProjectUserId,
  };
}

function mapUser(user: PostgresProjectUser): ReportUserItem {
  return {
    id: user.id,
    appUserId: user.appUserId,
    name: user.name || user.email || "Unknown user",
  };
}

function mapSourceAttributeDefinition(definition: PostgresSourceAttributeDefinition): ReportAttributeItem {
  return {
    id: definition.id,
    name: definition.name,
    dataType: definition.dataType,
  };
}

function mapSourceAttributeValue(value: PostgresSourceAttributeValue): ReportAttributeValueItem {
  return {
    id: value.id,
    ownerId: value.sourceId,
    attributeId: value.attributeDefinitionId,
    value: value.value,
  };
}

function mapObjectAttributeDefinition(definition: PostgresObjectAttributeDefinition): ReportAttributeItem {
  return {
    id: definition.id,
    name: definition.name,
    dataType: definition.dataType,
  };
}

function mapObjectAttributeValue(value: PostgresObjectAttributeValue): ReportAttributeValueItem {
  return {
    id: value.id,
    ownerId: value.objectId,
    attributeId: value.attributeDefinitionId,
    value: value.value,
  };
}

function mapProjectLogEntry(entry: PostgresProjectLogEntry): ProjectLogEntry {
  return {
    id: entry.id,
    projectId: entry.projectId,
    userId: entry.userId,
    userName: entry.userName,
    accessMode: entry.accessMode,
    action: entry.action,
    label: entry.label,
    recordId: entry.recordId,
    detailsJson: entry.detailsJson,
    occurredAt: entry.occurredAt,
    restoredAt: entry.restoredAt,
  };
}

export async function loadPostgresReportBuilderData(projectId: string): Promise<PostgresReportBuilderData> {
  const [snapshot, users, projectLogEntries, objectAttributeDefinitions, relationships] = await Promise.all([
    loadPostgresProjectWorkspaceSnapshot(projectId),
    listPostgresProjectUsers(projectId),
    listPostgresProjectLog(projectId),
    listPostgresObjectAttributeDefinitions(projectId),
    listPostgresRelationships(projectId),
  ]);
  const objectsById = new Map(snapshot.objects.map((object) => [object.id, object]));
  const sourceObjectLinks = snapshot.sourceObjectLinks.map((link) => ({
    caseId: link.objectId,
    documentId: link.sourceId,
  }));

  return {
    cases: snapshot.objects.map(mapObjectToCaseItem),
    relationships: relationships.map((relationship) => mapRelationship(relationship, objectsById)),
    users: users.map(mapUser),
    documents: snapshot.sources.map(mapSourceToDocument),
    codes: snapshot.codes.map(mapCode),
    annotations: snapshot.annotations.map(mapAnnotation),
    caseDocumentLinks: sourceObjectLinks,
    caseAttributeItems: objectAttributeDefinitions.map(mapObjectAttributeDefinition),
    documentAttributeItems: snapshot.sourceAttributeDefinitions.map(mapSourceAttributeDefinition),
    caseAttributeValues: snapshot.objects.flatMap((object) => object.attributeValues.map(mapObjectAttributeValue)),
    documentAttributeValues: snapshot.sourceAttributeValues.map(mapSourceAttributeValue),
    projectLogEntries: projectLogEntries.map(mapProjectLogEntry),
  };
}
