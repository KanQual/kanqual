export const PROJECT_UPLOADED_FILES_COLLECTION = "project_uploaded_files";

export type ProjectUploadedFileStatus = "active" | "processed" | "orphaned" | "deleted";
export type ProjectUploadedFileSourceKind = "document" | "case" | "other";

export type ProjectUploadedFileStatusEvent = {
  at: string;
  fromStatus: ProjectUploadedFileStatus | null;
  toStatus: ProjectUploadedFileStatus;
  reason: string;
  actorUserId: string | null;
  actorIdentifier: string;
  documentId?: string | null;
  caseId?: string | null;
};

export type ProjectUploadedFile = {
  id: string;
  projectId: string;
  documentId: string | null;
  caseId: string | null;
  uploadedFile: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  sourceKind: ProjectUploadedFileSourceKind;
  status: ProjectUploadedFileStatus;
  statusHistory: ProjectUploadedFileStatusEvent[];
  contentHash: string;
  importSummaryJson: string;
  createdBy: string | null;
  createdByIdentifier: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string;
};

type ProjectUploadedFileRecord = Record<string, unknown> & {
  id: string;
  created?: string;
  updated?: string;
};

function normalizeStatus(value: unknown): ProjectUploadedFileStatus {
  return value === "processed" || value === "orphaned" || value === "deleted" ? value : "active";
}

function normalizeSourceKind(value: unknown): ProjectUploadedFileSourceKind {
  return value === "case" || value === "other" ? value : "document";
}

export function parseUploadedFileStatusHistory(value: unknown): ProjectUploadedFileStatusEvent[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((event): event is ProjectUploadedFileStatusEvent => Boolean(event && typeof event === "object"))
      : [];
  } catch {
    return [];
  }
}

export function buildUploadedFileStatusEvent(input: {
  fromStatus: ProjectUploadedFileStatus | null;
  toStatus: ProjectUploadedFileStatus;
  reason: string;
  actorUserId: string | null;
  actorIdentifier: string;
  documentId?: string | null;
  caseId?: string | null;
}): ProjectUploadedFileStatusEvent {
  return {
    at: new Date().toISOString(),
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    reason: input.reason,
    actorUserId: input.actorUserId,
    actorIdentifier: input.actorIdentifier,
    documentId: input.documentId ?? null,
    caseId: input.caseId ?? null,
  };
}

export function toProjectUploadedFile(record: ProjectUploadedFileRecord): ProjectUploadedFile {
  const uploadedFile =
    Array.isArray(record.uploaded_file)
      ? String(record.uploaded_file[0] ?? "")
      : String(record.uploaded_file ?? "");
  return {
    id: record.id,
    projectId: String(record.project ?? ""),
    documentId: typeof record.document === "string" && record.document ? record.document : null,
    caseId: typeof record.case === "string" && record.case ? record.case : null,
    uploadedFile,
    originalFileName: String(record.original_file_name ?? ""),
    mimeType: String(record.mime_type ?? ""),
    sizeBytes: Number(record.size_bytes ?? 0),
    sourceKind: normalizeSourceKind(record.source_kind),
    status: normalizeStatus(record.status),
    statusHistory: parseUploadedFileStatusHistory(record.status_history_json),
    contentHash: String(record.content_hash ?? ""),
    importSummaryJson: String(record.import_summary_json ?? ""),
    createdBy: typeof record.created_by === "string" && record.created_by ? record.created_by : null,
    createdByIdentifier: String(record.created_by_identifier ?? ""),
    createdAt: String(record.created ?? ""),
    updatedAt: String(record.updated ?? ""),
    deletedAt: String(record.deleted_at ?? ""),
  };
}
