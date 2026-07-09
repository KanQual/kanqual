import type { Annotation, Case, Code, Document } from "../types";
import {
  listPostgresExperimentAnnotationSummaries,
  listPostgresExperimentCodes,
  listPostgresExperimentObjects,
  listPostgresExperimentObjectTypes,
  listPostgresExperimentSourceAttributeDefinitions,
  listPostgresExperimentSourceAttributeValues,
  listPostgresExperimentSourceLocks,
  listPostgresExperimentSourceObjectLinks,
  listPostgresExperimentSources,
  type PostgresExperimentAnnotationSummary,
  type PostgresExperimentCode,
  type PostgresExperimentObject,
  type PostgresExperimentObjectType,
  type PostgresExperimentSource,
  type PostgresExperimentSourceAttributeDefinition,
  type PostgresExperimentSourceAttributeValue,
  type PostgresExperimentSourceLock,
  type PostgresExperimentSourceObjectLink,
} from "./postgresExperiment";

export type PostgresProjectWorkspaceSnapshot = {
  sources: PostgresExperimentSource[];
  codes: PostgresExperimentCode[];
  annotations: PostgresExperimentAnnotationSummary[];
  objects: PostgresExperimentObject[];
  objectTypes: PostgresExperimentObjectType[];
  sourceLocks: PostgresExperimentSourceLock[];
  sourceObjectLinks: PostgresExperimentSourceObjectLink[];
  sourceAttributeDefinitions: PostgresExperimentSourceAttributeDefinition[];
  sourceAttributeValues: PostgresExperimentSourceAttributeValue[];
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

function mapSourceToLegacyDocument(source: PostgresExperimentSource): Document {
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

function mapCodeToLegacyCode(code: PostgresExperimentCode): Code {
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

function mapAnnotationToLegacyAnnotation(annotation: PostgresExperimentAnnotationSummary): Annotation {
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
  const [sources, codes, annotations, objects, objectTypes, sourceLocks, sourceObjectLinks, sourceAttributeDefinitions, sourceAttributeValues] = await Promise.all([
    listPostgresExperimentSources(projectId),
    listPostgresExperimentCodes(projectId),
    listPostgresExperimentAnnotationSummaries(projectId),
    listPostgresExperimentObjects(projectId),
    listPostgresExperimentObjectTypes(projectId),
    listPostgresExperimentSourceLocks(projectId),
    listPostgresExperimentSourceObjectLinks(projectId),
    listPostgresExperimentSourceAttributeDefinitions(projectId),
    listPostgresExperimentSourceAttributeValues(projectId),
  ]);

  return {
    sources,
    codes,
    annotations,
    objects,
    objectTypes,
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
