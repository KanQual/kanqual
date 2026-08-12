import type { Annotation, Case, Code, Document } from "../types";
import {
  listPostgresAnnotationSummaries,
  listPostgresCodes,
  listPostgresMemos,
  listPostgresObjectAttributeDefinitions,
  listPostgresObjects,
  listPostgresObjectTypes,
  listPostgresRelationships,
  listPostgresRelationshipAttributeDefinitions,
  listPostgresRelationshipTypes,
  listPostgresSourceAttributeDefinitions,
  listPostgresSourceAttributeValues,
  listPostgresSourceLocks,
  listPostgresSourceObjectLinks,
  listPostgresSources,
  type PostgresAnnotationSummary,
  type PostgresCode,
  type PostgresMemo,
  type PostgresObject,
  type PostgresObjectAttributeDefinition,
  type PostgresObjectType,
  type PostgresRelationship,
  type PostgresRelationshipAttributeDefinition,
  type PostgresRelationshipType,
  type PostgresSource,
  type PostgresSourceAttributeDefinition,
  type PostgresSourceAttributeValue,
  type PostgresSourceLock,
  type PostgresSourceObjectLink,
} from "./postgres";

export type PostgresProjectWorkspaceSnapshot = {
  sources: PostgresSource[];
  codes: PostgresCode[];
  annotations: PostgresAnnotationSummary[];
  memos: PostgresMemo[];
  objects: PostgresObject[];
  objectTypes: PostgresObjectType[];
  objectAttributeDefinitions: PostgresObjectAttributeDefinition[];
  relationships: PostgresRelationship[];
  relationshipTypes: PostgresRelationshipType[];
  relationshipAttributeDefinitions: PostgresRelationshipAttributeDefinition[];
  sourceLocks: PostgresSourceLock[];
  sourceObjectLinks: PostgresSourceObjectLink[];
  sourceAttributeDefinitions: PostgresSourceAttributeDefinition[];
  sourceAttributeValues: PostgresSourceAttributeValue[];
};

export type PostgresProjectWorkspaceLegacySnapshot = {
  documents: Document[];
  cases: Case[];
  codes: Code[];
  annotations: Annotation[];
  caseDocumentLinks: Array<{
    caseId: string;
    documentId: string;
  }>;
};

function mapSourceToLegacyDocument(source: PostgresSource): Document {
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

function mapCodeToLegacyCode(code: PostgresCode): Code {
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

function mapAnnotationToLegacyAnnotation(annotation: PostgresAnnotationSummary): Annotation {
  return {
    id: annotation.id,
    documentId: annotation.sourceId,
    codeId: annotation.primaryCodeId,
    startOffset: annotation.startOffset ?? 0,
    endOffset: annotation.endOffset ?? 0,
    quote: annotation.quote,
    note: annotation.note,
    createdAt: annotation.createdAt,
    createdBy: annotation.createdByName,
    createdById: annotation.createdByProjectUserId,
  };
}

export async function loadPostgresProjectWorkspaceSnapshot(
  projectId: string,
): Promise<PostgresProjectWorkspaceSnapshot> {
  const [sources, codes, annotations, memos, objects, objectTypes, objectAttributeDefinitions, relationships, relationshipTypes, relationshipAttributeDefinitions, sourceLocks, sourceObjectLinks, sourceAttributeDefinitions, sourceAttributeValues] = await Promise.all([
    listPostgresSources(projectId),
    listPostgresCodes(projectId),
    listPostgresAnnotationSummaries(projectId),
    listPostgresMemos(projectId),
    listPostgresObjects(projectId),
    listPostgresObjectTypes(projectId),
    listPostgresObjectAttributeDefinitions(projectId),
    listPostgresRelationships(projectId),
    listPostgresRelationshipTypes(projectId),
    listPostgresRelationshipAttributeDefinitions(projectId),
    listPostgresSourceLocks(projectId),
    listPostgresSourceObjectLinks(projectId),
    listPostgresSourceAttributeDefinitions(projectId),
    listPostgresSourceAttributeValues(projectId),
  ]);

  return {
    sources,
    codes,
    annotations,
    memos,
    objects,
    objectTypes,
    objectAttributeDefinitions,
    relationships,
    relationshipTypes,
    relationshipAttributeDefinitions,
    sourceLocks,
    sourceObjectLinks,
    sourceAttributeDefinitions,
    sourceAttributeValues,
  };
}

export async function loadPostgresProjectWorkspaceLegacySnapshot(
  projectId: string,
): Promise<PostgresProjectWorkspaceLegacySnapshot> {
  const snapshot = await loadPostgresProjectWorkspaceSnapshot(projectId);
  return {
    documents: snapshot.sources.map(mapSourceToLegacyDocument),
    cases: [],
    codes: snapshot.codes.map(mapCodeToLegacyCode),
    annotations: snapshot.annotations.map(mapAnnotationToLegacyAnnotation),
    caseDocumentLinks: [],
  };
}
