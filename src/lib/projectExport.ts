import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import type { PendingImportedUser, Project, Role } from "../types";
import { getBackendIdentitySnapshot } from "./pb";

type ExportTable = {
  name: string;
  rows: Record<string, unknown>[];
};

type ProjectExportAsset = {
  collection: string;
  recordId: string;
  field: string;
  fileName: string;
  mimeType: string;
  dataBase64: string;
};

export type ProjectExportData = {
  format: "kanqual-project-export";
  version: 1;
  exportedAt: string;
  project: Record<string, unknown>;
  tables: ExportTable[];
  assets: ProjectExportAsset[];
};

export type ProjectBackupReason = "automatic" | "manual" | "session";

export type ProjectBackupEnvelope = {
  kind: "kanqual-project-backup";
  version: 1;
  createdAt: string;
  projectId: string;
  projectName: string;
  reason: ProjectBackupReason;
  payload: ProjectExportData;
};

export type ImportedProjectSummary = {
  tableCounts: Record<string, number>;
  importedUsers: PendingImportedUser[];
  identityChecks: {
    backendMatched: boolean;
    usersTableMatched: boolean;
    allUsersPresent: boolean;
  };
  requiresUserResolution: boolean;
};

export type RefiQdaImportData = {
  name: string;
  description: string;
  documents: Array<{
    guid: string;
    name: string;
    content: string;
    notes: string;
    variableValues: RefiVariableValue[];
    selections: Array<{
      guid: string;
      startOffset: number;
      endOffset: number;
      note: string;
      codeGuid: string;
    }>;
  }>;
  codes: RefiCodeNode[];
  cases: Array<{
    guid: string;
    name: string;
    notes: string;
    sourceGuids: string[];
    variableValues: RefiVariableValue[];
  }>;
  variables: Array<{
    guid: string;
    name: string;
    dataType: "text" | "number" | "datetime";
  }>;
  notes: Array<{
    title: string;
    body: string;
  }>;
};

export type RefiCodeNode = {
  guid: string;
  name: string;
  color: string;
  description: string;
  children: RefiCodeNode[];
};

type RefiVariableValue = {
  variableGuid: string;
  value: string;
};

type ZipEntry = {
  method: number;
  compressed: Uint8Array;
  content?: Uint8Array;
};

const TABLE_SPECS: {
  name: string;
  filter: (projectId: string) => string;
  sort?: string;
  expand?: string;
}[] = [
  { name: "project_settings", filter: (id) => `project="${id}"`, sort: "created" },
  { name: "project_ai_chats", filter: (id) => `project="${id}"`, sort: "created" },
  { name: "project_ai_chat_messages", filter: (id) => `project="${id}"`, sort: "created" },
  { name: "project_members", filter: (id) => `project="${id}"`, sort: "created", expand: "user" },
  { name: "documents",         filter: (id) => `project="${id}"`,          sort: "created" },
  { name: "project_uploaded_files", filter: (id) => `project="${id}"`, sort: "created" },
  { name: "codes", filter: (id) => `project="${id}"`, sort: "created" },
  { name: "annotations", filter: (id) => `document.project="${id}"`, sort: "document,start_offset", expand: "created_by" },
  { name: "cases", filter: (id) => `project="${id}"`, sort: "created" },
  { name: "case_documents", filter: (id) => `case.project="${id}"`, sort: "created" },
  { name: "case_attributes", filter: (id) => `case.project="${id}"`, sort: "sort_order,created" },
  { name: "case_attribute_definitions", filter: (id) => `project="${id}"`, sort: "sort_order,created" },
  { name: "case_attribute_values", filter: (id) => `case.project="${id}"`, sort: "created" },
  { name: "document_attribute_definitions", filter: (id) => `project="${id}"`, sort: "sort_order,created" },
  { name: "document_attribute_values", filter: (id) => `document.project="${id}"`, sort: "created" },
  { name: "memos", filter: (id) => `project="${id}"`, sort: "created" },
  { name: "code_reports", filter: (id) => `project="${id}"`, sort: "created" },
  { name: "coder_reports", filter: (id) => `project="${id}"`, sort: "created" },
  { name: "ai_analyses", filter: (id) => `project="${id}"`, sort: "created" },
  { name: "project_log", filter: (id) => `project="${id}"`, sort: "occurred_at" },
];

const XLSX_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function cleanValue(value: unknown): unknown {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(cleanValue);
  if (typeof value === "object") return serializeRecord(value as Record<string, unknown>);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") return value;
  return String(value);
}

function serializeRecord(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "function") continue;
    if (key.startsWith("@")) continue;
    out[key] = cleanValue(value);
  }
  return out;
}

function flattenForSheet(row: Record<string, unknown>): Record<string, string | number | boolean> {
  const flat: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value == null) {
      flat[key] = "";
    } else if (Array.isArray(value)) {
      flat[key] = value.map((v) => typeof v === "object" ? JSON.stringify(v) : String(v)).join("; ");
    } else if (typeof value === "object") {
      flat[key] = JSON.stringify(value);
    } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      flat[key] = value;
    } else {
      flat[key] = String(value);
    }
  }
  return flat;
}

function collectColumns(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(flattenForSheet(row))) seen.add(key);
  }
  return [...seen];
}

function firstFileName(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";
  return typeof value === "string" ? value : "";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const slice = bytes.subarray(index, Math.min(index + chunkSize, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

async function fetchTable(
  pb: PocketBase,
  name: string,
  options: { filter: string; sort?: string; expand?: string },
): Promise<ExportTable> {
  const records = await pb.collection(name).getFullList({
    filter: options.filter,
    sort: options.sort,
    expand: options.expand,
  });
  return { name, rows: records.map((r: RecordModel) => serializeRecord(r)) };
}

async function fetchUploadedFileAssets(pb: PocketBase, projectId: string): Promise<ProjectExportAsset[]> {
  const records = await pb.collection("project_uploaded_files").getFullList({
    filter: `project="${projectId}"`,
    sort: "created",
  });
  const assets: ProjectExportAsset[] = [];
  for (const record of records) {
    const fileName = firstFileName(record.uploaded_file);
    if (!fileName) continue;
    const response = await fetch(pb.files.getURL(record, fileName));
    if (!response.ok) {
      throw new Error(`Could not fetch retained uploaded file "${fileName}" for export.`);
    }
    assets.push({
      collection: "project_uploaded_files",
      recordId: record.id,
      field: "uploaded_file",
      fileName,
      mimeType: typeof record.mime_type === "string"
        ? record.mime_type
        : response.headers.get("content-type") ?? "application/octet-stream",
      dataBase64: bytesToBase64(new Uint8Array(await response.arrayBuffer())),
    });
  }
  return assets;
}

function usersTableFromMembers(membersTable: ExportTable | undefined): ExportTable {
  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  for (const member of membersTable?.rows ?? []) {
    const expanded = member.expand && typeof member.expand === "object"
      ? member.expand as Record<string, unknown>
      : {};
    const user = expanded.user && typeof expanded.user === "object"
      ? expanded.user as Record<string, unknown>
      : {};
    const id = typeof user.id === "string" ? user.id : typeof member.user === "string" ? member.user : "";
    const email = typeof user.email === "string" ? user.email : "";
    if (!id || !email || seen.has(id)) continue;
    seen.add(id);
    rows.push({
      id,
      name: typeof user.name === "string" ? user.name : "",
      email,
      user_identifier: typeof user.user_identifier === "string" ? user.user_identifier : "",
    });
  }
  return { name: "users", rows };
}

export async function fetchProjectExportData(pb: PocketBase, project: Project): Promise<ProjectExportData> {
  const projectRecord = await pb.collection("projects").getOne(project.id);
  const tables = await Promise.all(
    TABLE_SPECS.map((spec) =>
      fetchTable(pb, spec.name, {
        filter: spec.filter(project.id),
        sort: spec.sort,
        expand: spec.expand,
      }),
    ),
  );
  const assets = await fetchUploadedFileAssets(pb, project.id);
  const projectMembers = tables.find((table) => table.name === "project_members");
  const usersTable = usersTableFromMembers(projectMembers);

  return {
    format: "kanqual-project-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    project: serializeRecord(projectRecord),
    tables: [{ name: "projects", rows: [serializeRecord(projectRecord)] }, usersTable, ...tables],
    assets,
  };
}

export function makeProjectBackupEnvelope(
  data: ProjectExportData,
  reason: ProjectBackupReason = "manual",
): ProjectBackupEnvelope {
  return {
    kind: "kanqual-project-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    projectId: String(data.project.id ?? ""),
    projectName: String(data.project.name ?? "Kanqual Project"),
    reason,
    payload: data,
  };
}

export function makeProjectBackupJson(
  data: ProjectExportData,
  reason: ProjectBackupReason = "manual",
): string {
  return JSON.stringify(makeProjectBackupEnvelope(data, reason), null, 2);
}

function tableRows(data: ProjectExportData, name: string): Record<string, unknown>[] {
  return data.tables.find((table) => table.name === name)?.rows ?? [];
}

function findTable(data: ProjectExportData, name: string): Record<string, unknown>[] {
  return tableRows(data, name);
}

function assertProjectExportData(value: unknown): ProjectExportData {
  if (!value || typeof value !== "object") {
    throw new Error("The selected file is not a Kanqual project export.");
  }
  const data = value as ProjectExportData;
  if (data.format !== "kanqual-project-export" || !Array.isArray(data.tables)) {
    throw new Error("The selected file is not a Kanqual project export.");
  }
  if (!Array.isArray(data.assets)) {
    data.assets = [];
  }
  return data;
}

function stripSystemFields(row: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (["id", "collectionId", "collectionName", "created", "updated", "expand"].includes(key)) continue;
    payload[key] = value;
  }
  return payload;
}

function remapOptionalRelation(value: unknown, idMap: Map<string, string>): string | undefined {
  if (typeof value !== "string") return undefined;
  return idMap.get(value);
}

function remapRequiredRelation(value: unknown, idMap: Map<string, string>): string | null {
  if (typeof value !== "string") return null;
  return idMap.get(value) ?? null;
}

function remapRelationList(value: unknown, idMap: Map<string, string>): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? idMap.get(item) : undefined))
    .filter((item): item is string => typeof item === "string" && item.length > 0);
}

function currentUserId(pb: PocketBase): string {
  return pb.authStore.record?.id ?? "";
}

function currentUserEmail(pb: PocketBase): string {
  return String(pb.authStore.record?.email ?? "").trim().toLowerCase();
}
void currentUserEmail;

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeEmail(value: unknown): string {
  return textValue(value).trim().toLowerCase();
}

function roleValue(value: unknown): Role {
  return value === "owner" || value === "editor" || value === "coder" || value === "viewer"
    ? value
    : "viewer";
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string" && value) return [value];
  return [];
}

function importedUsersFromBackup(data: ProjectExportData): PendingImportedUser[] {
  const roleBySourceUserId = new Map<string, Role>();
  for (const row of findTable(data, "project_members")) {
    const sourceUserId = textValue(row.user);
    if (!sourceUserId) continue;
    roleBySourceUserId.set(sourceUserId, roleValue(row.role));
  }

  return findTable(data, "users").map((row) => ({
    sourceUserId: textValue(row.id),
    userIdentifier: textValue(row.user_identifier),
    name: textValue(row.name) || normalizeEmail(row.email),
    email: normalizeEmail(row.email),
    role: roleBySourceUserId.get(textValue(row.id)) ?? "viewer",
    status: "no_access" as const,
  })).filter((row) => row.sourceUserId && row.userIdentifier && row.email);
}

async function validateImportedUsers(
  pb: PocketBase,
  data: ProjectExportData,
  idMap: Map<string, string>,
): Promise<ImportedProjectSummary> {
  const identity = await getBackendIdentitySnapshot(pb);
  const importedUsers = importedUsersFromBackup(data);
  const backupBackendIdentifier = textValue(data.project.backend_identifier);
  const backupUsersTableIdentifier = textValue(data.project.users_table_identifier);
  const backendMatched = !!backupBackendIdentifier && backupBackendIdentifier === identity.backendIdentifier;
  const usersTableMatched = !!backupUsersTableIdentifier && backupUsersTableIdentifier === identity.usersTableIdentifier;
  const hasUserTable = importedUsers.length > 0;
  let allUsersPresent = false;

  if (backendMatched && usersTableMatched && hasUserTable) {
    const currentUsers = await pb.collection("users").getFullList({ sort: "created" });
    const usersByIdentifier = new Map<string, RecordModel>();
    currentUsers.forEach((user) => {
      if (typeof user.user_identifier === "string" && user.user_identifier) {
        usersByIdentifier.set(user.user_identifier, user);
      }
    });

    allUsersPresent = importedUsers.every((user) => usersByIdentifier.has(user.userIdentifier));

    if (allUsersPresent) {
      importedUsers.forEach((user) => {
        const matchingUser = usersByIdentifier.get(user.userIdentifier);
        if (!matchingUser) return;
        idMap.set(user.sourceUserId, matchingUser.id);
      });
    }
  }

  return {
    tableCounts: {},
    importedUsers,
    identityChecks: {
      backendMatched,
      usersTableMatched,
      allUsersPresent,
    },
    requiresUserResolution: !(backendMatched && usersTableMatched && allUsersPresent),
  };
}

async function createMappedRecord(
  pb: PocketBase,
  collection: string,
  row: Record<string, unknown>,
  payload: Record<string, unknown>,
  idMap: Map<string, string>,
  tableCounts: Record<string, number>,
): Promise<RecordModel> {
  let record: RecordModel;
  try {
    record = await pb.collection(collection).create(payload);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error ?? "Unknown error");
    const sourceId = typeof row.id === "string" ? row.id : "";
    throw new Error(
      `Failed to import ${collection}${sourceId ? ` record ${sourceId}` : ""}: ${detail}`,
    );
  }
  if (typeof row.id === "string") idMap.set(row.id, record.id);
  tableCounts[collection] = (tableCounts[collection] ?? 0) + 1;
  return record;
}

async function importProjectSettingsRecord(
  pb: PocketBase,
  row: Record<string, unknown>,
  projectId: string,
  idMap: Map<string, string>,
  tableCounts: Record<string, number>,
): Promise<RecordModel> {
  const payload = {
    ...stripSystemFields(row),
    project: projectId,
  };
  const existing = await pb.collection("project_settings").getFirstListItem(`project="${projectId}"`).catch(() => null);
  if (existing) {
    const updated = await pb.collection("project_settings").update(existing.id, payload);
    if (typeof row.id === "string") idMap.set(row.id, updated.id);
    tableCounts.project_settings = (tableCounts.project_settings ?? 0) + 1;
    return updated;
  }
  return createMappedRecord(pb, "project_settings", row, payload, idMap, tableCounts);
}

type ImportContext = {
  pb: PocketBase;
  projectId: string;
  idMap: Map<string, string>;
  tableCounts: Record<string, number>;
  userId: string;
  canReassociateUsers: boolean;
  sourceIdentifier: (value: unknown) => string;
  uploadedFileAssetsByKey: Map<string, ProjectExportAsset>;
};

type ImportStep = {
  table: string;
  when?: (context: ImportContext) => boolean;
  importRow: (row: Record<string, unknown>, context: ImportContext) => Promise<void>;
};

function importedCreatedBy(context: ImportContext, value: unknown): string | undefined {
  if (!context.canReassociateUsers) return context.userId || undefined;
  return remapOptionalRelation(value, context.idMap) || context.userId || undefined;
}

async function createScheduledRecord(
  collection: string,
  row: Record<string, unknown>,
  payload: Record<string, unknown>,
  context: ImportContext,
): Promise<RecordModel> {
  return createMappedRecord(
    context.pb,
    collection,
    row,
    payload,
    context.idMap,
    context.tableCounts,
  );
}

function assetKey(collection: string, recordId: string, field: string, fileName: string): string {
  return `${collection}::${recordId}::${field}::${fileName}`;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

const IMPORT_SCHEDULE: ImportStep[] = [
  {
    table: "project_settings",
    importRow: async (row, context) => {
      await importProjectSettingsRecord(
        context.pb,
        row,
        context.projectId,
        context.idMap,
        context.tableCounts,
      );
    },
  },
  {
    table: "project_ai_chats",
    when: (context) => context.canReassociateUsers,
    importRow: async (row, context) => {
      await createScheduledRecord("project_ai_chats", row, {
        ...stripSystemFields(row),
        project: context.projectId,
        created_by: importedCreatedBy(context, row.created_by),
        created_by_identifier: context.sourceIdentifier(row.created_by),
        participant_users: remapRelationList(row.participant_users, context.idMap),
        participant_identifiers_json: typeof row.participant_identifiers_json === "string" ? row.participant_identifiers_json : "[]",
      }, context);
    },
  },
  {
    table: "project_ai_chat_messages",
    when: (context) => context.canReassociateUsers,
    importRow: async (row, context) => {
      const chatId = remapRequiredRelation(row.chat, context.idMap);
      if (!chatId) return;
      await createScheduledRecord("project_ai_chat_messages", row, {
        ...stripSystemFields(row),
        chat: chatId,
        project: context.projectId,
        created_by: remapOptionalRelation(row.created_by, context.idMap),
        created_by_identifier: context.sourceIdentifier(row.created_by),
      }, context);
    },
  },
  {
    table: "project_members",
    when: (context) => context.canReassociateUsers,
    importRow: async (row, context) => {
      const mappedUser = remapRequiredRelation(row.user, context.idMap);
      if (!mappedUser || mappedUser === context.userId) return;
      await createScheduledRecord("project_members", row, {
        ...stripSystemFields(row),
        project: context.projectId,
        user: mappedUser,
        user_identifier: typeof row.user_identifier === "string" ? row.user_identifier : context.sourceIdentifier(row.user),
        created_by: remapOptionalRelation(row.created_by, context.idMap) || context.userId || undefined,
      }, context);
    },
  },
  {
    table: "documents",
    importRow: async (row, context) => {
      await createScheduledRecord("documents", row, {
        ...stripSystemFields(row),
        project: context.projectId,
        type: textValue(row.type).trim() || "Text",
        created_by: importedCreatedBy(context, row.created_by),
        created_by_identifier: context.sourceIdentifier(row.created_by),
      }, context);
    },
  },
  {
    table: "cases",
    importRow: async (row, context) => {
      await createScheduledRecord("cases", row, {
        ...stripSystemFields(row),
        project: context.projectId,
        created_by: importedCreatedBy(context, row.created_by),
        created_by_identifier: context.sourceIdentifier(row.created_by),
      }, context);
    },
  },
  {
    table: "project_uploaded_files",
    importRow: async (row, context) => {
      const sourceId = textValue(row.id);
      const fileName = firstFileName(row.uploaded_file);
      const asset = context.uploadedFileAssetsByKey.get(
        assetKey("project_uploaded_files", sourceId, "uploaded_file", fileName),
      );
      if (!asset) {
        throw new Error(`The backup is missing the retained source file payload for uploaded file record ${sourceId || "(unknown)"}.`);
      }
      await createScheduledRecord("project_uploaded_files", row, {
        ...stripSystemFields(row),
        project: context.projectId,
        document: remapOptionalRelation(row.document, context.idMap) ?? null,
        case: remapOptionalRelation(row.case, context.idMap) ?? null,
        uploaded_file: new File(
          [base64ToBytes(asset.dataBase64)],
          asset.fileName,
          { type: asset.mimeType || textValue(row.mime_type) || "application/octet-stream" },
        ),
        created_by: importedCreatedBy(context, row.created_by),
        created_by_identifier: context.sourceIdentifier(row.created_by),
      }, context);
    },
  },
  {
    table: "case_attribute_definitions",
    importRow: async (row, context) => {
      await createScheduledRecord("case_attribute_definitions", row, {
        ...stripSystemFields(row),
        project: context.projectId,
      }, context);
    },
  },
  {
    table: "document_attribute_definitions",
    importRow: async (row, context) => {
      await createScheduledRecord("document_attribute_definitions", row, {
        ...stripSystemFields(row),
        project: context.projectId,
      }, context);
    },
  },
  {
    table: "codes",
    importRow: async (row, context) => {
      await createScheduledRecord("codes", row, {
        ...stripSystemFields(row),
        project: context.projectId,
        parent: null,
        created_by: importedCreatedBy(context, row.created_by),
        created_by_identifier: context.sourceIdentifier(row.created_by),
      }, context);
    },
  },
  {
    table: "codes",
    importRow: async (row, context) => {
      if (typeof row.id !== "string" || typeof row.parent !== "string") return;
      const nextId = context.idMap.get(row.id);
      const nextParent = context.idMap.get(row.parent);
      if (!nextId || !nextParent) return;
      await context.pb.collection("codes").update(nextId, { parent: nextParent });
    },
  },
  {
    table: "case_documents",
    importRow: async (row, context) => {
      const caseId = remapRequiredRelation(row.case, context.idMap);
      const documentId = remapRequiredRelation(row.document, context.idMap);
      if (!caseId || !documentId) return;
      await createScheduledRecord("case_documents", row, {
        ...stripSystemFields(row),
        case: caseId,
        document: documentId,
      }, context);
    },
  },
  {
    table: "case_attributes",
    importRow: async (row, context) => {
      const caseId = remapRequiredRelation(row.case, context.idMap);
      if (!caseId) return;
      await createScheduledRecord("case_attributes", row, {
        ...stripSystemFields(row),
        case: caseId,
      }, context);
    },
  },
  {
    table: "case_attribute_values",
    importRow: async (row, context) => {
      const caseId = remapRequiredRelation(row.case, context.idMap);
      const attributeId = remapRequiredRelation(row.attribute, context.idMap);
      if (!caseId || !attributeId) return;
      await createScheduledRecord("case_attribute_values", row, {
        ...stripSystemFields(row),
        case: caseId,
        attribute: attributeId,
      }, context);
    },
  },
  {
    table: "document_attribute_values",
    importRow: async (row, context) => {
      const documentId = remapRequiredRelation(row.document, context.idMap);
      const attributeId = remapRequiredRelation(row.attribute, context.idMap);
      if (!documentId || !attributeId) return;
      await createScheduledRecord("document_attribute_values", row, {
        ...stripSystemFields(row),
        document: documentId,
        attribute: attributeId,
      }, context);
    },
  },
  {
    table: "annotations",
    importRow: async (row, context) => {
      const documentId = remapRequiredRelation(row.document, context.idMap);
      const codeId = remapRequiredRelation(row.code, context.idMap);
      if (!documentId || !codeId) return;
      await createScheduledRecord("annotations", row, {
        ...stripSystemFields(row),
        document: documentId,
        code: codeId,
        created_by: importedCreatedBy(context, row.created_by),
        created_by_identifier: context.sourceIdentifier(row.created_by),
      }, context);
    },
  },
  {
    table: "memos",
    importRow: async (row, context) => {
      await createScheduledRecord("memos", row, {
        ...stripSystemFields(row),
        project: context.projectId,
        document: remapRelationList(row.document, context.idMap),
        annotation: remapRelationList(row.annotation, context.idMap),
        cases: remapRelationList(row.cases, context.idMap),
        codes: remapRelationList(row.codes, context.idMap),
        case_attribute_defs: remapRelationList(row.case_attribute_defs, context.idMap),
        document_attribute_defs: remapRelationList(row.document_attribute_defs, context.idMap),
        created_by: importedCreatedBy(context, row.created_by),
        created_by_identifier: context.sourceIdentifier(row.created_by),
      }, context);
    },
  },
  {
    table: "code_reports",
    importRow: async (row, context) => {
      await createScheduledRecord("code_reports", row, {
        ...stripSystemFields(row),
        project: context.projectId,
        cases: remapRelationList(row.cases, context.idMap),
        documents: remapRelationList(row.documents, context.idMap),
        codes: remapRelationList(row.codes, context.idMap),
        created_by: importedCreatedBy(context, row.created_by),
        created_by_identifier: context.sourceIdentifier(row.created_by),
      }, context);
    },
  },
  {
    table: "coder_reports",
    importRow: async (row, context) => {
      await createScheduledRecord("coder_reports", row, {
        ...stripSystemFields(row),
        project: context.projectId,
        cases: remapRelationList(row.cases, context.idMap),
        documents: remapRelationList(row.documents, context.idMap),
        codes: remapRelationList(row.codes, context.idMap),
        coders: context.canReassociateUsers ? remapRelationList(row.coders, context.idMap) : [],
        coder_identifiers: JSON.stringify(
          stringArray(row.coders).map((value) => context.sourceIdentifier(value)).filter(Boolean),
        ),
        created_by: importedCreatedBy(context, row.created_by),
        created_by_identifier: context.sourceIdentifier(row.created_by),
      }, context);
    },
  },
  {
    table: "ai_analyses",
    importRow: async (row, context) => {
      await createScheduledRecord("ai_analyses", row, {
        ...stripSystemFields(row),
        project: context.projectId,
        code: remapOptionalRelation(row.code, context.idMap) ?? null,
        created_by: importedCreatedBy(context, row.created_by),
        created_by_identifier: context.sourceIdentifier(row.created_by),
      }, context);
    },
  },
  {
    table: "project_log",
    importRow: async (row, context) => {
      await createScheduledRecord("project_log", row, {
        ...stripSystemFields(row),
        project: context.projectId,
        user: context.canReassociateUsers ? remapOptionalRelation(row.user, context.idMap) || context.userId || undefined : context.userId || undefined,
        user_identifier: context.sourceIdentifier(row.user),
        user_name: typeof row.user_name === "string" ? row.user_name : context.pb.authStore.record?.name || context.pb.authStore.record?.email || "",
        record_id: typeof row.record_id === "string" ? context.idMap.get(row.record_id) ?? row.record_id : "",
      }, context);
    },
  },
];

export function parseProjectBackupJson(text: string): ProjectExportData {
  const parsed = JSON.parse(text);
  if (
    parsed &&
    typeof parsed === "object" &&
    (parsed as ProjectBackupEnvelope).kind === "kanqual-project-backup"
  ) {
    return assertProjectExportData((parsed as ProjectBackupEnvelope).payload);
  }
  return assertProjectExportData(parsed);
}

export async function importProjectBackupIntoProject(
  pb: PocketBase,
  data: ProjectExportData,
  projectId: string,
): Promise<ImportedProjectSummary> {
  const idMap = new Map<string, string>();
  const tableCounts: Record<string, number> = {};
  const userId = currentUserId(pb);
  const validation = await validateImportedUsers(pb, data, idMap);
  const importedUsers = validation.importedUsers;
  const canReassociateUsers = !validation.requiresUserResolution;
  const importedUsersBySourceId = new Map(importedUsers.map((user) => [user.sourceUserId, user]));
  const context: ImportContext = {
    pb,
    projectId,
    idMap,
    tableCounts,
    userId,
    canReassociateUsers,
    sourceIdentifier: (value: unknown) => importedUsersBySourceId.get(textValue(value))?.userIdentifier || "",
    uploadedFileAssetsByKey: new Map(
      (data.assets ?? []).map((asset) => [
        assetKey(asset.collection, asset.recordId, asset.field, asset.fileName),
        asset,
      ]),
    ),
  };

  for (const step of IMPORT_SCHEDULE) {
    if (step.when && !step.when(context)) continue;
    for (const row of findTable(data, step.table)) {
      await step.importRow(row, context);
    }
  }

  return {
    tableCounts,
    importedUsers,
    identityChecks: validation.identityChecks,
    requiresUserResolution: validation.requiresUserResolution,
  };
}

function xmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sheetName(name: string, index: number): string {
  const safe = name.replace(/[\[\]:*?/\\]/g, "_").slice(0, 28);
  return safe || `Sheet ${index + 1}`;
}

function columnName(index: number): string {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - rem - 1) / 26);
  }
  return name;
}

function worksheetXml(table: ExportTable): string {
  const columns = collectColumns(table.rows);
  const rows = [
    columns,
    ...table.rows.map((row) => {
      const flat = flattenForSheet(row);
      return columns.map((column) => flat[column] ?? "");
    }),
  ];

  const rowXml = rows.map((row, rowIndex) => {
    const cells = row.map((value, colIndex) => {
      const ref = `${columnName(colIndex)}${rowIndex + 1}`;
      if (typeof value === "number" && Number.isFinite(value)) {
        return `<c r="${ref}"><v>${value}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${XLSX_NS}"><sheetData>${rowXml}</sheetData></worksheet>`;
}

function workbookXml(tables: ExportTable[]): string {
  const sheets = tables.map((table, index) =>
    `<sheet name="${xmlEscape(sheetName(table.name, index))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${XLSX_NS}" xmlns:r="${REL_NS}"><sheets>${sheets}</sheets></workbook>`;
}

function workbookRelsXml(tables: ExportTable[]): string {
  const worksheetRels = tables.map((_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  ).join("");
  const stylesRel = `<Relationship Id="rId${tables.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${worksheetRels}${stylesRel}</Relationships>`;
}

function contentTypesXml(tables: ExportTable[]): string {
  const sheetOverrides = tables.map((_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetOverrides}</Types>`;
}

function rootRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${XLSX_NS}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(out: number[], value: number): void {
  out.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeUint32(out: number[], value: number): void {
  out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function dosDateTime(date = new Date()): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function createZip(files: { path: string; content: string | Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const out: number[] = [];
  const central: number[] = [];
  const timestamp = dosDateTime();

  for (const file of files) {
    const pathBytes = encoder.encode(file.path);
    const contentBytes = typeof file.content === "string" ? encoder.encode(file.content) : file.content;
    const offset = out.length;
    const crc = crc32(contentBytes);

    writeUint32(out, 0x04034b50);
    writeUint16(out, 20);
    writeUint16(out, 0);
    writeUint16(out, 0);
    writeUint16(out, timestamp.time);
    writeUint16(out, timestamp.date);
    writeUint32(out, crc);
    writeUint32(out, contentBytes.length);
    writeUint32(out, contentBytes.length);
    writeUint16(out, pathBytes.length);
    writeUint16(out, 0);
    out.push(...pathBytes, ...contentBytes);

    writeUint32(central, 0x02014b50);
    writeUint16(central, 20);
    writeUint16(central, 20);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, timestamp.time);
    writeUint16(central, timestamp.date);
    writeUint32(central, crc);
    writeUint32(central, contentBytes.length);
    writeUint32(central, contentBytes.length);
    writeUint16(central, pathBytes.length);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint32(central, 0);
    writeUint32(central, offset);
    central.push(...pathBytes);
  }

  const centralOffset = out.length;
  out.push(...central);
  writeUint32(out, 0x06054b50);
  writeUint16(out, 0);
  writeUint16(out, 0);
  writeUint16(out, files.length);
  writeUint16(out, files.length);
  writeUint32(out, central.length);
  writeUint32(out, centralOffset);
  writeUint16(out, 0);

  return new Uint8Array(out);
}

function readZipUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readZipUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream("deflate-raw");
  const output = new Response(stream.readable).arrayBuffer();
  const writer = stream.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  return new Uint8Array(await output);
}

function readZipEntries(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (readZipUint32(view, i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("The selected file is not a valid QDPX/ZIP file.");

  const entryCount = readZipUint16(view, eocdOffset + 10);
  let centralOffset = readZipUint32(view, eocdOffset + 16);
  const entries = new Map<string, ZipEntry>();

  for (let i = 0; i < entryCount; i++) {
    if (readZipUint32(view, centralOffset) !== 0x02014b50) {
      throw new Error("The selected QDPX file has an unreadable ZIP directory.");
    }
    const method = readZipUint16(view, centralOffset + 10);
    const compressedSize = readZipUint32(view, centralOffset + 20);
    const fileNameLength = readZipUint16(view, centralOffset + 28);
    const extraLength = readZipUint16(view, centralOffset + 30);
    const commentLength = readZipUint16(view, centralOffset + 32);
    const localOffset = readZipUint32(view, centralOffset + 42);
    const name = decoder.decode(bytes.slice(centralOffset + 46, centralOffset + 46 + fileNameLength));

    if (!name.endsWith("/")) {
      const localNameLength = readZipUint16(view, localOffset + 26);
      const localExtraLength = readZipUint16(view, localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(dataOffset, dataOffset + compressedSize);
      if (method === 0 || method === 8) entries.set(name, { method, compressed });
    }
    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

async function zipEntryContent(entry: ZipEntry): Promise<Uint8Array> {
  if (entry.content) return entry.content;
  if (entry.method === 0) {
    entry.content = entry.compressed;
  } else if (entry.method === 8) {
    entry.content = await inflateRaw(entry.compressed);
  } else {
    throw new Error("The selected QDPX file uses an unsupported ZIP compression method.");
  }
  return entry.content;
}

async function zipText(entries: Map<string, ZipEntry>, path: string): Promise<string | null> {
  const match = entries.get(path) ?? entries.get(path.replace(/\\/g, "/"));
  return match ? new TextDecoder().decode(await zipEntryContent(match)) : null;
}

async function findRefiProjectXml(entries: Map<string, ZipEntry>): Promise<string> {
  const preferred = await zipText(entries, "project.qde");
  if (preferred) return preferred;
  for (const [path, entry] of entries) {
    if (path.toLowerCase().endsWith(".qde") || path.toLowerCase().endsWith(".xml")) {
      return new TextDecoder().decode(await zipEntryContent(entry));
    }
  }
  throw new Error("The selected QDPX file does not contain a REFI-QDA project XML file.");
}

function localName(el: Element): string {
  return el.localName || el.nodeName.split(":").pop() || el.nodeName;
}

function childElements(el: Element, name?: string): Element[] {
  return Array.from(el.children).filter((child) => !name || localName(child) === name);
}

function childElement(el: Element, name: string): Element | null {
  return childElements(el, name)[0] ?? null;
}

function childText(el: Element, name: string): string {
  return childElement(el, name)?.textContent?.trim() ?? "";
}

function attrValue(el: Element, name: string): string {
  return el.getAttribute(name) ?? "";
}

function parseRefiVariableType(value: string): "text" | "number" | "datetime" {
  const lowered = value.toLowerCase();
  if (lowered.includes("float") || lowered.includes("integer") || lowered.includes("number")) return "number";
  if (lowered.includes("date")) return "datetime";
  return "text";
}

function parseVariableValues(el: Element): RefiVariableValue[] {
  return childElements(el, "VariableValue").map((valueEl) => {
    const ref = childElement(valueEl, "VariableRef");
    const valueNode = childElements(valueEl).find((child) => localName(child).endsWith("Value") && localName(child) !== "VariableRef");
    return {
      variableGuid: attrValue(ref ?? valueEl, "targetGUID"),
      value: valueNode?.textContent?.trim() ?? "",
    };
  }).filter((value) => value.variableGuid && value.value);
}

function parseRefiCode(el: Element): RefiCodeNode {
  return {
    guid: attrValue(el, "guid"),
    name: attrValue(el, "name") || "Untitled code",
    color: attrValue(el, "color") || "#f59e0b",
    description: childText(el, "Description"),
    children: childElements(el, "Code").map(parseRefiCode),
  };
}

function parseRefiCodebookXml(text: string): RefiCodeNode[] {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) throw new Error("The selected REFI-QDA Codebook XML could not be parsed.");

  const root = Array.from(doc.getElementsByTagName("*")).find((el) => localName(el) === "CodeBook");
  if (!root) throw new Error("The selected file does not contain a REFI-QDA CodeBook element.");

  const codesEl = childElement(root, "Codes");
  return codesEl ? childElements(codesEl, "Code").map(parseRefiCode) : [];
}

export function parseRefiQdaCodebook(text: string): RefiCodeNode[] {
  return parseRefiCodebookXml(text);
}

function sourcePathCandidates(path: string): string[] {
  const cleaned = path.replace(/^internal:\/\//i, "").replace(/^internal:\//i, "").replace(/^\/+/, "");
  const normalized = cleaned.replace(/\\/g, "/");
  return [
    normalized,
    `Sources/${normalized}`,
    `sources/${normalized}`,
  ];
}

async function sourceText(entries: Map<string, ZipEntry>, sourceEl: Element): Promise<string> {
  const embedded = childText(sourceEl, "PlainTextContent");
  if (embedded) return embedded;
  const path = attrValue(sourceEl, "plainTextPath") || attrValue(sourceEl, "path");
  for (const candidate of sourcePathCandidates(path)) {
    const text = await zipText(entries, candidate);
    if (text != null) return text;
  }
  return "";
}

export async function parseRefiQdaProject(bytes: Uint8Array): Promise<RefiQdaImportData> {
  const entries = readZipEntries(bytes);
  const xml = await findRefiProjectXml(entries);
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) throw new Error("The selected QDPX project XML could not be parsed.");
  const projectEl = Array.from(doc.getElementsByTagName("*")).find((el) => localName(el) === "Project");
  if (!projectEl) throw new Error("The selected QDPX file does not contain a REFI-QDA Project element.");

  const codeBook = childElement(projectEl, "CodeBook");
  const codesEl = codeBook ? childElement(codeBook, "Codes") : null;
  const variablesEl = childElement(projectEl, "Variables");
  const sourcesEl = childElement(projectEl, "Sources");
  const casesEl = childElement(projectEl, "Cases");
  const notesEl = childElement(projectEl, "Notes");

  const documents = sourcesEl ? await Promise.all(childElements(sourcesEl).filter((source) => localName(source).endsWith("Source")).map(async (source) => {
    const content = await sourceText(entries, source);
    return {
      guid: attrValue(source, "guid"),
      name: attrValue(source, "name") || "Untitled source",
      content,
      notes: childText(source, "Description"),
      variableValues: parseVariableValues(source),
      selections: childElements(source, "PlainTextSelection").map((selection, index) => {
        const coding = childElement(selection, "Coding");
        const codeRef = coding ? childElement(coding, "CodeRef") : null;
        const startOffset = Number(attrValue(selection, "startPosition"));
        const endOffset = Number(attrValue(selection, "endPosition"));
        return {
          guid: attrValue(selection, "guid") || `${attrValue(source, "guid")}-selection-${index}`,
          startOffset: Number.isFinite(startOffset) ? startOffset : 0,
          endOffset: Number.isFinite(endOffset) ? endOffset : 0,
          note: childText(selection, "Description"),
          codeGuid: attrValue(codeRef ?? selection, "targetGUID"),
        };
      }).filter((selection) => selection.codeGuid),
    };
  })) : [];
  const textDocuments = documents.filter((source) => source.guid);

  return {
    name: attrValue(projectEl, "name") || "Imported REFI-QDA Project",
    description: childText(projectEl, "Description"),
    documents: textDocuments,
    codes: codesEl ? childElements(codesEl, "Code").map(parseRefiCode) : [],
    cases: casesEl ? childElements(casesEl, "Case").map((caseEl) => ({
      guid: attrValue(caseEl, "guid"),
      name: attrValue(caseEl, "name") || "Untitled case",
      notes: childText(caseEl, "Description"),
      sourceGuids: childElements(caseEl, "SourceRef").map((ref) => attrValue(ref, "targetGUID")).filter(Boolean),
      variableValues: parseVariableValues(caseEl),
    })).filter((caseRow) => caseRow.guid) : [],
    variables: variablesEl ? childElements(variablesEl, "Variable").map((variable) => ({
      guid: attrValue(variable, "guid"),
      name: attrValue(variable, "name") || "Untitled variable",
      dataType: parseRefiVariableType(attrValue(variable, "typeOfVariable")),
    })).filter((variable) => variable.guid) : [],
    notes: notesEl ? childElements(notesEl, "Note").map((note) => ({
      title: attrValue(note, "name") || "Untitled memo",
      body: childText(note, "PlainTextContent") || note.textContent?.trim() || "",
    })) : [],
  };
}

export async function importRefiQdaIntoProject(
  pb: PocketBase,
  data: RefiQdaImportData,
  projectId: string,
): Promise<ImportedProjectSummary> {
  const tableCounts: Record<string, number> = {};
  const userId = currentUserId(pb);
  const codeMap = new Map<string, string>();
  const documentMap = new Map<string, string>();
  const caseMap = new Map<string, string>();
  const caseVariableMap = new Map<string, string>();
  const documentVariableMap = new Map<string, string>();

  async function bump(collection: string): Promise<void> {
    tableCounts[collection] = (tableCounts[collection] ?? 0) + 1;
  }

  async function createCodeTree(nodes: RefiCodeNode[], parentId = ""): Promise<void> {
    for (const node of nodes) {
      const record = await pb.collection("codes").create({
        project: projectId,
        label: node.name,
        color: node.color,
        description: node.description,
        parent: parentId || null,
        created_by: userId || undefined,
      });
      codeMap.set(node.guid, record.id);
      await bump("codes");
      await createCodeTree(node.children, record.id);
    }
  }

  await createCodeTree(data.codes);

  for (const doc of data.documents) {
    const record = await pb.collection("documents").create({
      project: projectId,
      name: doc.name,
      type: "Text",
      file_path: "",
      content: doc.content,
      notes: doc.notes,
      created_by: userId || undefined,
    });
    documentMap.set(doc.guid, record.id);
    await bump("documents");
  }

  for (const variable of data.variables) {
    const caseDef = await pb.collection("case_attribute_definitions").create({
      project: projectId,
      name: variable.name,
      data_type: variable.dataType,
      sort_order: caseVariableMap.size,
      deleted_at: "",
    });
    const docDef = await pb.collection("document_attribute_definitions").create({
      project: projectId,
      name: variable.name,
      data_type: variable.dataType,
      sort_order: documentVariableMap.size,
      deleted_at: "",
    });
    caseVariableMap.set(variable.guid, caseDef.id);
    documentVariableMap.set(variable.guid, docDef.id);
    await bump("case_attribute_definitions");
    await bump("document_attribute_definitions");
  }

  for (const caseRow of data.cases) {
    const record = await pb.collection("cases").create({
      project: projectId,
      name: caseRow.name,
      notes: caseRow.notes,
      created_by: userId || undefined,
    });
    caseMap.set(caseRow.guid, record.id);
    await bump("cases");

    for (const sourceGuid of caseRow.sourceGuids) {
      const documentId = documentMap.get(sourceGuid);
      if (!documentId) continue;
      await pb.collection("case_documents").create({ case: record.id, document: documentId });
      await bump("case_documents");
    }

    for (const value of caseRow.variableValues) {
      const attributeId = caseVariableMap.get(value.variableGuid);
      if (!attributeId) continue;
      await pb.collection("case_attribute_values").create({
        case: record.id,
        attribute: attributeId,
        value: value.value,
        deleted_at: "",
      });
      await bump("case_attribute_values");
    }
  }

  for (const doc of data.documents) {
    const documentId = documentMap.get(doc.guid);
    if (!documentId) continue;

    for (const value of doc.variableValues) {
      const attributeId = documentVariableMap.get(value.variableGuid);
      if (!attributeId) continue;
      await pb.collection("document_attribute_values").create({
        document: documentId,
        attribute: attributeId,
        value: value.value,
        deleted_at: "",
      });
      await bump("document_attribute_values");
    }

    for (const selection of doc.selections) {
      const codeId = codeMap.get(selection.codeGuid);
      if (!codeId) continue;
      const startOffset = Math.max(0, Math.min(selection.startOffset, doc.content.length));
      const endOffset = Math.max(startOffset, Math.min(selection.endOffset, doc.content.length));
      const quote = doc.content.slice(startOffset, endOffset).trim() || selection.note?.trim() || "[Imported selection]";
      await pb.collection("annotations").create({
        document: documentId,
        code: codeId,
        start_offset: startOffset,
        end_offset: endOffset,
        quote,
        note: selection.note,
        created_by: userId || undefined,
        deleted_at: "",
      });
      await bump("annotations");
    }
  }

  for (const note of data.notes) {
    await pb.collection("memos").create({
      project: projectId,
      title: note.title,
      body: note.body,
      created_by: userId || undefined,
      deleted_at: "",
    });
    await bump("memos");
  }

  await pb.collection("project_log").create({
    project: projectId,
    user: userId || undefined,
    user_name: pb.authStore.record?.name || pb.authStore.record?.email || "",
    action: "project.import",
    label: "Imported REFI-QDA project",
    record_id: projectId,
  });
  await bump("project_log");

  return {
    tableCounts,
    importedUsers: [],
    identityChecks: {
      backendMatched: false,
      usersTableMatched: false,
      allUsersPresent: false,
    },
    requiresUserResolution: false,
  };
}

export async function importRefiQdaCodebookIntoProject(
  pb: PocketBase,
  codes: RefiCodeNode[],
  projectId: string,
): Promise<ImportedProjectSummary> {
  const tableCounts: Record<string, number> = {};
  const userId = currentUserId(pb);

  async function createCodeTree(nodes: RefiCodeNode[], parentId = ""): Promise<void> {
    for (const node of nodes) {
      const record = await pb.collection("codes").create({
        project: projectId,
        label: node.name,
        color: node.color,
        description: node.description,
        parent: parentId || null,
        created_by: userId || undefined,
      });
      tableCounts.codes = (tableCounts.codes ?? 0) + 1;
      await createCodeTree(node.children, record.id);
    }
  }

  await createCodeTree(codes);
  return {
    tableCounts,
    importedUsers: [],
    identityChecks: {
      backendMatched: false,
      usersTableMatched: false,
      allUsersPresent: false,
    },
    requiresUserResolution: false,
  };
}

export function makeProjectBackupXlsx(data: ProjectExportData): Uint8Array {
  const files = [
    { path: "[Content_Types].xml", content: contentTypesXml(data.tables) },
    { path: "_rels/.rels", content: rootRelsXml() },
    { path: "xl/workbook.xml", content: workbookXml(data.tables) },
    { path: "xl/_rels/workbook.xml.rels", content: workbookRelsXml(data.tables) },
    { path: "xl/styles.xml", content: stylesXml() },
    ...data.tables.map((table, index) => ({
      path: `xl/worksheets/sheet${index + 1}.xml`,
      content: worksheetXml(table),
    })),
  ];
  return createZip(files);
}

function hash32(value: string, seed: number): number {
  let hash = 0x811c9dc5 ^ seed;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function guidFor(kind: string, id: unknown): string {
  const input = `${kind}:${String(id || kind)}`;
  const hex = [0, 1, 2, 3].map((seed) => hash32(input, seed).toString(16).padStart(8, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function refiDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function attr(name: string, value: unknown): string {
  if (value == null || value === "") return "";
  return ` ${name}="${xmlEscape(value)}"`;
}

function element(name: string, attrs: Record<string, unknown>, children = ""): string {
  const attrText = Object.entries(attrs).map(([key, value]) => attr(key, value)).join("");
  return children ? `<${name}${attrText}>${children}</${name}>` : `<${name}${attrText}/>`;
}

function textElement(name: string, value: unknown): string {
  if (value == null || value === "") return "";
  return `<${name}>${xmlEscape(value)}</${name}>`;
}

function safeSourceFileName(name: string, id: unknown): string {
  const safeName = (name || "source").replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_").replace(/\s+/g, "_").slice(0, 80);
  return `${safeName}_${String(id).slice(0, 8)}.txt`;
}

function variableType(dataType: unknown): string {
  if (dataType === "number") return "Float";
  if (dataType === "datetime") return "DateTime";
  return "Text";
}

function variableValueXml(variableGuid: string, dataType: unknown, value: unknown): string {
  if (value == null || value === "") return "";
  const tag = dataType === "number" ? "FloatValue" : dataType === "datetime" ? "DateTimeValue" : "TextValue";
  return `<VariableValue><VariableRef targetGUID="${variableGuid}"/>${textElement(tag, value)}</VariableValue>`;
}

function codeXml(code: Record<string, unknown>, childrenByParent: Map<string, Record<string, unknown>[]>): string {
  const children = childrenByParent.get(String(code.id)) ?? [];
  const body = [
    textElement("Description", code.description),
    ...children.map((child) => codeXml(child, childrenByParent)),
  ].join("");
  return element("Code", {
    guid: guidFor("code", code.id),
    name: code.label || "Untitled code",
    isCodable: "true",
    color: code.color,
  }, body);
}

function refiCodeBookXmlFromCodes(codes: Record<string, unknown>[]): string {
  const childrenByParent = new Map<string, Record<string, unknown>[]>();
  for (const code of codes) {
    const parent = typeof code.parent === "string" ? code.parent : "";
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent)!.push(code);
  }
  const topCodes = childrenByParent.get("") ?? [];
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<CodeBook xmlns="urn:QDA-XML:codebook:1.0" xmlns:qda="urn:QDA-XML:codebook:1.0" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xsi:schemaLocation="urn:QDA-XML:codebook:1.0 http://schema.qdasoftware.org/versions/Codebook/v1.0/Codebook.xsd">` +
    `<Codes>${topCodes.map((code) => codeXml(code, childrenByParent)).join("")}</Codes>` +
    `</CodeBook>`;
}

export function makeRefiQdaCodebook(data: ProjectExportData): string {
  const codes = tableRows(data, "codes").filter((row) => !row.deleted_at);
  return refiCodeBookXmlFromCodes(codes);
}

function makeRefiProjectXml(data: ProjectExportData): string {
  const project = data.project;
  const members = tableRows(data, "project_members");
  const documents = tableRows(data, "documents").filter((row) => !row.deleted_at);
  const codes = tableRows(data, "codes").filter((row) => !row.deleted_at);
  const annotations = tableRows(data, "annotations").filter((row) => !row.deleted_at);
  const cases = tableRows(data, "cases").filter((row) => !row.deleted_at);
  const caseDocuments = tableRows(data, "case_documents");
  const caseAttrDefs = tableRows(data, "case_attribute_definitions").filter((row) => !row.deleted_at);
  const caseAttrValues = tableRows(data, "case_attribute_values").filter((row) => !row.deleted_at);
  const docAttrDefs = tableRows(data, "document_attribute_definitions").filter((row) => !row.deleted_at);
  const docAttrValues = tableRows(data, "document_attribute_values").filter((row) => !row.deleted_at);
  const memos = tableRows(data, "memos").filter((row) => !row.deleted_at);

  const userRows = members
    .map((member) => {
      const expanded = member.expand && typeof member.expand === "object" ? member.expand as Record<string, unknown> : {};
      const user = expanded.user && typeof expanded.user === "object" ? expanded.user as Record<string, unknown> : {};
      return {
        guid: guidFor("user", member.user),
        id: member.user,
        name: user.name || user.email || member.user || "Unknown user",
      };
    })
    .filter((user, index, users) => users.findIndex((u) => u.id === user.id) === index);

  const usersXml = userRows.length
    ? element("Users", {}, userRows.map((user) => element("User", user)).join(""))
    : "";

  const childrenByParent = new Map<string, Record<string, unknown>[]>();
  for (const code of codes) {
    const parent = typeof code.parent === "string" ? code.parent : "";
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent)!.push(code);
  }
  const topCodes = childrenByParent.get("") ?? [];
  const codeBookXml = topCodes.length
    ? `<CodeBook><Codes>${topCodes.map((code) => codeXml(code, childrenByParent)).join("")}</Codes></CodeBook>`
    : "";

  const allVariableDefs: Array<Record<string, unknown> & { scope: "case" | "document" }> = [
    ...caseAttrDefs.map((row) => ({ ...row, scope: "case" as const })),
    ...docAttrDefs.map((row) => ({ ...row, scope: "document" as const })),
  ];
  const variablesXml = allVariableDefs.length
    ? element("Variables", {}, allVariableDefs.map((row) =>
        element("Variable", {
          guid: guidFor(`${row.scope}_variable`, row.id),
          name: row.scope === "case" ? `Case: ${row.name}` : `Document: ${row.name}`,
          typeOfVariable: variableType(row.data_type),
        })
      ).join(""))
    : "";

  const caseDocMap = new Map<string, string[]>();
  for (const link of caseDocuments) {
    if (typeof link.case !== "string" || typeof link.document !== "string") continue;
    if (!caseDocMap.has(link.case)) caseDocMap.set(link.case, []);
    caseDocMap.get(link.case)!.push(link.document);
  }
  const caseValuesByCase = new Map<string, Record<string, unknown>[]>();
  for (const value of caseAttrValues) {
    if (typeof value.case !== "string") continue;
    if (!caseValuesByCase.has(value.case)) caseValuesByCase.set(value.case, []);
    caseValuesByCase.get(value.case)!.push(value);
  }
  const caseDefById = new Map(caseAttrDefs.map((def) => [String(def.id), def]));
  const casesXml = cases.length
    ? element("Cases", {}, cases.map((row) => {
        const variableValues = (caseValuesByCase.get(String(row.id)) ?? []).map((value) => {
          const def = caseDefById.get(String(value.attribute));
          return def ? variableValueXml(guidFor("case_variable", def.id), def.data_type, value.value) : "";
        }).join("");
        const sourceRefs = (caseDocMap.get(String(row.id)) ?? [])
          .map((docId) => element("SourceRef", { targetGUID: guidFor("document", docId) }))
          .join("");
        return element("Case", { guid: guidFor("case", row.id), name: row.name }, [
          textElement("Description", row.notes),
          variableValues,
          sourceRefs,
        ].join(""));
      }).join(""))
    : "";

  const annotationsByDocument = new Map<string, Record<string, unknown>[]>();
  for (const annotation of annotations) {
    if (typeof annotation.document !== "string") continue;
    if (!annotationsByDocument.has(annotation.document)) annotationsByDocument.set(annotation.document, []);
    annotationsByDocument.get(annotation.document)!.push(annotation);
  }
  const docValuesByDoc = new Map<string, Record<string, unknown>[]>();
  for (const value of docAttrValues) {
    if (typeof value.document !== "string") continue;
    if (!docValuesByDoc.has(value.document)) docValuesByDoc.set(value.document, []);
    docValuesByDoc.get(value.document)!.push(value);
  }
  const docDefById = new Map(docAttrDefs.map((def) => [String(def.id), def]));
  const sourcesXml = documents.length
    ? element("Sources", {}, documents.map((doc) => {
        const selections = (annotationsByDocument.get(String(doc.id)) ?? []).map((annotation, index) => {
          const coding = element("Coding", {
            guid: guidFor("coding", annotation.id),
            creatingUser: annotation.created_by ? guidFor("user", annotation.created_by) : undefined,
            creationDateTime: refiDate(annotation.created),
          }, element("CodeRef", { targetGUID: guidFor("code", annotation.code) }));
          return element("PlainTextSelection", {
            guid: guidFor("annotation", annotation.id),
            name: `Selection ${index + 1}`,
            startPosition: annotation.start_offset,
            endPosition: annotation.end_offset,
            creatingUser: annotation.created_by ? guidFor("user", annotation.created_by) : undefined,
            creationDateTime: refiDate(annotation.created),
          }, textElement("Description", annotation.note) + coding);
        }).join("");
        const variableValues = (docValuesByDoc.get(String(doc.id)) ?? []).map((value) => {
          const def = docDefById.get(String(value.attribute));
          return def ? variableValueXml(guidFor("document_variable", def.id), def.data_type, value.value) : "";
        }).join("");
        return element("TextSource", {
          guid: guidFor("document", doc.id),
          name: doc.name,
          plainTextPath: `internal://${safeSourceFileName(String(doc.name || "source"), doc.id)}`,
          creatingUser: doc.created_by ? guidFor("user", doc.created_by) : undefined,
          creationDateTime: refiDate(doc.created),
          modifiedDateTime: refiDate(doc.updated),
        }, textElement("Description", doc.notes) + selections + variableValues);
      }).join(""))
    : "";

  const notesXml = memos.length
    ? element("Notes", {}, memos.map((memo) =>
        element("Note", {
          guid: guidFor("memo", memo.id),
          name: memo.title || "Untitled memo",
          creatingUser: memo.created_by ? guidFor("user", memo.created_by) : undefined,
          creationDateTime: refiDate(memo.created),
          modifiedDateTime: refiDate(memo.updated),
        }, textElement("PlainTextContent", memo.body))
      ).join(""))
    : "";

  const body = [
    usersXml,
    codeBookXml,
    variablesXml,
    casesXml,
    sourcesXml,
    notesXml,
    textElement("Description", project.description),
  ].join("");

  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Project xmlns="urn:QDA-XML:project:1.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"` +
    attr("name", project.name || "Kanqual Project") +
    attr("origin", "Kanqual") +
    attr("creationDateTime", refiDate(project.created)) +
    attr("modifiedDateTime", refiDate(project.updated)) +
    attr("basePath", ".") +
    `>${body}</Project>`;
}

export function makeRefiQdaProject(data: ProjectExportData): Uint8Array {
  const documents = tableRows(data, "documents").filter((row) => !row.deleted_at);
  const files = [
    { path: "project.qde", content: makeRefiProjectXml(data) },
    ...documents.map((doc) => ({
      path: `Sources/${safeSourceFileName(String(doc.name || "source"), doc.id)}`,
      content: String(doc.content ?? ""),
    })),
  ];
  return createZip(files);
}
