import {
  createPostgresCode,
  listPostgresAiAnalyses,
  listPostgresProjectLog,
  listPostgresProjectUsers,
  listPostgresReports,
  type PostgresCode,
  type PostgresProject,
} from "./postgres";
import { loadPostgresProjectWorkspaceSnapshot } from "./postgresProjectWorkspace";
import type { ProjectExportData, RefiCodeNode } from "./projectExport";

function rowFromRecord<T extends Record<string, unknown>>(record: T): Record<string, unknown> {
  return { ...record };
}

function codeRow(code: PostgresCode): Record<string, unknown> {
  return {
    id: code.id,
    project: code.projectId,
    label: code.label,
    name: code.label,
    color: code.color,
    description: code.description,
    shortcut: code.shortcut,
    parent: code.parentCodeId,
    parent_code_id: code.parentCodeId,
    sort_order: code.sortOrder,
    created: code.createdAt,
    updated: code.updatedAt,
  };
}

function safeCodeColor(color: string | undefined): string {
  const trimmed = String(color ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : "#6b7280";
}

export async function fetchPostgresProjectExportData(project: PostgresProject): Promise<ProjectExportData> {
  const [snapshot, users, projectLog, reports, aiAnalyses] = await Promise.all([
    loadPostgresProjectWorkspaceSnapshot(project.id),
    listPostgresProjectUsers(project.id),
    listPostgresProjectLog(project.id),
    listPostgresReports(project.id),
    listPostgresAiAnalyses(project.id),
  ]);

  const projectRow = {
    id: project.id,
    name: project.name,
    description: project.description,
    database_name: project.databaseName,
    storage_path: project.storagePath,
    disabled_at: project.disabledAt,
    created: project.createdAt,
    updated: project.updatedAt,
  };

  const documentRows = snapshot.sources.map((source) => ({
    id: source.id,
    project: source.projectId,
    name: source.title,
    title: source.title,
    type: source.sourceKind,
    source_kind: source.sourceKind,
    original_file_name: source.originalFileName,
    file_path: source.storagePath,
    storage_path: source.storagePath,
    content: source.textContent,
    text_content: source.textContent,
    structured_content_json: source.structuredContentJson,
    notes: source.notes,
    created: source.createdAt,
    updated: source.updatedAt,
  }));

  const codeRows = snapshot.codes.map(codeRow);
  const annotationRows = snapshot.annotations.map((annotation) => ({
    id: annotation.id,
    display_id: annotation.displayId,
    project: annotation.projectId,
    document: annotation.sourceId,
    source_id: annotation.sourceId,
    source_kind: annotation.sourceKind,
    code: annotation.primaryCodeId,
    code_ids: annotation.codeIds,
    start_offset: annotation.startOffset,
    end_offset: annotation.endOffset,
    time_start_ms: annotation.timeStartMs,
    time_end_ms: annotation.timeEndMs,
    quote: annotation.quote,
    note: annotation.note,
    anchor_kind: annotation.anchorKind,
    image_region: annotation.imageRegion,
    created_by: annotation.createdByProjectUserId,
    created_by_name: annotation.createdByName,
    created: annotation.createdAt,
    updated: annotation.updatedAt,
  }));

  const caseRows = snapshot.objects.map((object) => ({
    id: object.id,
    project: object.projectId,
    name: object.title,
    title: object.title,
    notes: object.description,
    description: object.description,
    object_type_id: object.objectTypeId,
    object_type: object.objectType,
    created: object.createdAt,
    updated: object.updatedAt,
  }));

  const caseDocumentRows = snapshot.sourceObjectLinks.map((link) => ({
    id: `${link.objectId}:${link.sourceId}`,
    case: link.objectId,
    object_id: link.objectId,
    document: link.sourceId,
    source_id: link.sourceId,
    created: link.createdAt,
    updated: link.createdAt,
  }));

  const documentAttributeDefinitionRows = snapshot.sourceAttributeDefinitions.map((definition) => ({
    id: definition.id,
    project: definition.projectId,
    name: definition.name,
    data_type: definition.dataType,
    description: definition.description,
    options: definition.options,
    source_kinds: definition.sourceKinds,
    sort_order: definition.sortOrder,
    created: definition.createdAt,
    updated: definition.updatedAt,
  }));

  const documentAttributeValueRows = snapshot.sourceAttributeValues.map((value) => ({
    id: value.id,
    document: value.sourceId,
    source_id: value.sourceId,
    attribute: value.attributeDefinitionId,
    attribute_definition_id: value.attributeDefinitionId,
    name: value.attributeName,
    data_type: value.dataType,
    value: value.value,
    sort_order: value.sortOrder,
  }));

  const caseAttributeDefinitionRows = snapshot.objectAttributeDefinitions.map((definition) => ({
    id: definition.id,
    project: definition.projectId,
    object_type_id: definition.objectTypeId,
    object_type: definition.objectType,
    name: definition.name,
    data_type: definition.dataType,
    description: definition.description,
    options: definition.options,
    sort_order: definition.sortOrder,
    created: definition.createdAt,
    updated: definition.updatedAt,
  }));

  const caseAttributeValueRows = snapshot.objects.flatMap((object) =>
    object.attributeValues.map((value) => ({
      id: value.id,
      case: value.objectId,
      object_id: value.objectId,
      attribute: value.attributeDefinitionId,
      attribute_definition_id: value.attributeDefinitionId,
      name: value.attributeName,
      data_type: value.dataType,
      value: value.value,
      sort_order: value.sortOrder,
    })),
  );

  return {
    format: "kanqual-project-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    project: projectRow,
    assets: [],
    tables: [
      { name: "projects", rows: [projectRow] },
      { name: "project_members", rows: users.map((user) => ({
        id: user.id,
        project: user.projectId,
        user: user.appUserId,
        role: user.role,
        name: user.name,
        email: user.email,
        created: user.createdAt,
        updated: user.updatedAt,
      })) },
      { name: "users", rows: users.map((user) => ({
        id: user.appUserId || user.id,
        name: user.name,
        email: user.email,
      })) },
      { name: "documents", rows: documentRows },
      { name: "sources", rows: snapshot.sources.map((source) => rowFromRecord(source as unknown as Record<string, unknown>)) },
      { name: "codes", rows: codeRows },
      { name: "annotations", rows: annotationRows },
      { name: "cases", rows: caseRows },
      { name: "objects", rows: snapshot.objects.map((object) => rowFromRecord(object as unknown as Record<string, unknown>)) },
      { name: "case_documents", rows: caseDocumentRows },
      { name: "source_object_links", rows: snapshot.sourceObjectLinks.map((link) => rowFromRecord(link as unknown as Record<string, unknown>)) },
      { name: "document_attribute_definitions", rows: documentAttributeDefinitionRows },
      { name: "document_attribute_values", rows: documentAttributeValueRows },
      { name: "source_attribute_definitions", rows: snapshot.sourceAttributeDefinitions.map((definition) => rowFromRecord(definition as unknown as Record<string, unknown>)) },
      { name: "source_attribute_values", rows: snapshot.sourceAttributeValues.map((value) => rowFromRecord(value as unknown as Record<string, unknown>)) },
      { name: "case_attribute_definitions", rows: caseAttributeDefinitionRows },
      { name: "case_attribute_values", rows: caseAttributeValueRows },
      { name: "object_types", rows: snapshot.objectTypes.map((type) => rowFromRecord(type as unknown as Record<string, unknown>)) },
      { name: "object_attribute_definitions", rows: snapshot.objectAttributeDefinitions.map((definition) => rowFromRecord(definition as unknown as Record<string, unknown>)) },
      { name: "relationships", rows: snapshot.relationships.map((relationship) => rowFromRecord(relationship as unknown as Record<string, unknown>)) },
      { name: "relationship_types", rows: snapshot.relationshipTypes.map((type) => rowFromRecord(type as unknown as Record<string, unknown>)) },
      { name: "relationship_attribute_definitions", rows: snapshot.relationshipAttributeDefinitions.map((definition) => rowFromRecord(definition as unknown as Record<string, unknown>)) },
      { name: "memos", rows: snapshot.memos.map((memo) => ({
        id: memo.id,
        project: memo.projectId,
        title: memo.title,
        body: memo.body,
        source_ids: memo.sourceIds,
        annotation_ids: memo.annotationIds,
        code_ids: memo.codeIds,
        object_ids: memo.objectIds,
        created_by: memo.createdByProjectUserId,
        created_by_name: memo.createdByName,
        created: memo.createdAt,
        updated: memo.updatedAt,
      })) },
      { name: "reports", rows: reports.map((report) => rowFromRecord(report as unknown as Record<string, unknown>)) },
      { name: "ai_analyses", rows: aiAnalyses.map((analysis) => rowFromRecord(analysis as unknown as Record<string, unknown>)) },
      { name: "project_log", rows: projectLog.map((entry) => rowFromRecord(entry as unknown as Record<string, unknown>)) },
    ],
  };
}

export async function importPostgresRefiQdaCodebook(
  projectId: string,
  nodes: RefiCodeNode[],
  parentCodeId: string | null = null,
): Promise<number> {
  let importedCount = 0;
  for (const node of nodes) {
    const code = await createPostgresCode({
      projectId,
      label: node.name.trim() || "Imported code",
      color: safeCodeColor(node.color),
      description: node.description,
      parentCodeId,
    });
    importedCount += 1;
    importedCount += await importPostgresRefiQdaCodebook(projectId, node.children ?? [], code.id);
  }
  return importedCount;
}
