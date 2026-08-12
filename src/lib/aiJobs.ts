import {
  cancelPostgresAiJob,
  createPostgresAiJob,
  getPostgresAiJob,
  type PostgresAiJob,
} from "./postgres";

export const AI_JOB_COLLECTION = "ai_jobs";

export type AiJobType =
  | "project_chat"
  | "document_processing"
  | "attribute_suggestions"
  | "embedding_build"
  | "relevant_segments_search"
  | "code_conceptual_summary"
  | "most_typical_annotation"
  | "code_decomposition"
  | "code_position"
  | "code_unique_annotations";
export type AiJobStatus = "queued" | "running" | "completed" | "error";

export type ProjectChatAiJobRequest = {
  projectId: string;
  query: string;
  conversation: Array<{ role: string; content: string }>;
  selectedContextMode: "default" | "prioritize" | "restrict";
  selectedDocumentIds: string[];
  selectedCaseIds: string[];
  selectedRelationshipIds?: string[];
  selectedCodeIds: string[];
  selectedAnnotationIds: string[];
  selectedMemoIds: string[];
};

export type ProjectChatAiJobResult = {
  content: string;
  model: string;
  baseUrl: string;
  usedContextItems: number;
  citations: Array<{
    id: string;
    itemType: string;
    title: string;
    preview: string;
    sourceId?: string | null;
    objectId?: string | null;
    documentId?: string | null;
    caseId?: string | null;
    relationshipId?: string | null;
    codeId?: string | null;
    annotationId?: string | null;
    memoId?: string | null;
    startOffset?: number | null;
    endOffset?: number | null;
  }>;
};

export type DocumentProcessingAiJobRequest = {
  projectId: string;
  documentIds: string[];
  reviewLenses: Record<"speaker-segmentation" | "named-entity-extraction", boolean>;
  restartDocumentIds?: string[];
};

export type AttributeSuggestionAiJobRequest = {
  projectId: string;
  runId: string;
  attributeName: string;
  attributeDataType: string;
  attributeDescription: string;
  attributeOptions: string[];
  items: Array<{
    id: string;
    name: string;
    content: string;
  }>;
};

export type AttributeSuggestionAiJobResult = {
  model: string;
  baseUrl: string;
  suggestions: Array<{
    itemId: string;
    itemName: string;
    suggestedValue: string;
    evidenceText: string;
  }>;
};

export type EmbeddingBuildAiJobRequest = {
  projectId: string;
};

export type RelevantSegmentsAiJobRequest = {
  projectId: string;
  activeDocumentId: string;
  codeId: string;
  codeLabel: string;
  codeDescription: string | null;
};

export type RelevantSegmentsAiJobResult = {
  model: string;
  baseUrl: string;
  searchedItems: number;
  segments: Array<{
    id: string;
    itemType: string;
    title: string;
    preview: string;
    matchText?: string;
    reason: string;
    similarity: number;
    sourceId?: string;
    objectId?: string;
    documentId?: string;
    codeId?: string;
    annotationId?: string;
    startOffset?: number;
    endOffset?: number;
  }>;
};

export type CodeAnalysisAnnotationInput = {
  quote: string;
  documentName: string;
};

export type CodeAnalysisBaseAiJobRequest = {
  projectId: string;
  codeId: string;
  codeLabel: string;
  codeDescription: string | null;
  annotations: CodeAnalysisAnnotationInput[];
};

export type CodePositionAiJobRequest = CodeAnalysisBaseAiJobRequest & {
  codebook: Array<{
    label: string;
    description: string | null;
    parentLabel: string | null;
  }>;
};

export type CodeConceptualSummaryAiJobResult = {
  content: string;
  model: string;
  baseUrl: string;
};

export type MostTypicalAnnotationAiJobResult = {
  annotations: Array<{
    annotationIndex: number;
    reasoning: string;
  }>;
  model: string;
};

export type CodeDecompositionAiJobResult = {
  content: string;
  model: string;
};

export type CodePositionAiJobResult = {
  content: string;
  model: string;
};

export type CodeUniqueAnnotationsAiJobResult = {
  annotations: Array<{
    annotationIndex: number;
    reasoning: string;
  }>;
  model: string;
};

export type AiJobRecord = {
  id: string;
  projectId: string;
  jobType: AiJobType;
  status: AiJobStatus;
  requestJson: string;
  resultJson: string;
  errorMessage: string;
  hostMessage: string;
  createdBy: string;
};

function normalizeJsonField(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null || value === "") return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseAiJobStatus(value: unknown): AiJobStatus {
  return value === "running" || value === "completed" || value === "error" ? value : "queued";
}

function parseAiJobType(value: unknown): AiJobType {
  switch (value) {
    case "document_processing":
    case "attribute_suggestions":
    case "embedding_build":
    case "relevant_segments_search":
    case "code_conceptual_summary":
    case "most_typical_annotation":
    case "code_decomposition":
    case "code_position":
    case "code_unique_annotations":
      return value;
    default:
      return "project_chat";
  }
}

export function toAiJobRecord(record: Record<string, unknown>): AiJobRecord {
  return {
    id: String(record.id ?? ""),
    projectId: String(record.project ?? ""),
    jobType: parseAiJobType(record.job_type),
    status: parseAiJobStatus(record.status),
    requestJson: normalizeJsonField(record.request_json),
    resultJson: normalizeJsonField(record.result_json),
    errorMessage: String(record.error_message ?? ""),
    hostMessage: String(record.host_message ?? ""),
    createdBy: String(record.created_by ?? ""),
  };
}

export function toAiJobRecordFromPostgres(job: PostgresAiJob): AiJobRecord {
  return {
    id: job.id,
    projectId: job.projectId,
    jobType: job.jobType,
    status: job.status,
    requestJson: job.requestJson,
    resultJson: job.resultJson,
    errorMessage: job.errorMessage,
    hostMessage: job.hostMessage,
    createdBy: job.createdByProjectUserId,
  };
}

export function isLocalBackendUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    const host = url.hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

async function createAiJob<TRequest>(
  jobType: AiJobType,
  projectId: string,
  request: TRequest,
): Promise<AiJobRecord> {
  const record = await createPostgresAiJob({
    projectId,
    jobType,
    requestJson: JSON.stringify(request),
  });
  return toAiJobRecordFromPostgres(record);
}

export async function createProjectChatAiJob(
  request: ProjectChatAiJobRequest,
): Promise<AiJobRecord> {
  return createAiJob("project_chat", request.projectId, request);
}

export async function createDocumentProcessingAiJob(
  request: DocumentProcessingAiJobRequest,
): Promise<AiJobRecord> {
  return createAiJob("document_processing", request.projectId, request);
}

export async function createAttributeSuggestionAiJob(
  request: AttributeSuggestionAiJobRequest,
): Promise<AiJobRecord> {
  return createAiJob("attribute_suggestions", request.projectId, request);
}

export async function createEmbeddingBuildAiJob(
  request: EmbeddingBuildAiJobRequest,
): Promise<AiJobRecord> {
  return createAiJob("embedding_build", request.projectId, request);
}

export async function createRelevantSegmentsAiJob(
  request: RelevantSegmentsAiJobRequest,
): Promise<AiJobRecord> {
  return createAiJob("relevant_segments_search", request.projectId, request);
}

export async function createCodeConceptualSummaryAiJob(
  request: CodeAnalysisBaseAiJobRequest,
): Promise<AiJobRecord> {
  return createAiJob("code_conceptual_summary", request.projectId, request);
}

export async function createMostTypicalAnnotationAiJob(
  request: CodeAnalysisBaseAiJobRequest,
): Promise<AiJobRecord> {
  return createAiJob("most_typical_annotation", request.projectId, request);
}

export async function createCodeDecompositionAiJob(
  request: CodeAnalysisBaseAiJobRequest,
): Promise<AiJobRecord> {
  return createAiJob("code_decomposition", request.projectId, request);
}

export async function createCodePositionAiJob(
  request: CodePositionAiJobRequest,
): Promise<AiJobRecord> {
  return createAiJob("code_position", request.projectId, request);
}

export async function createCodeUniqueAnnotationsAiJob(
  request: CodeAnalysisBaseAiJobRequest,
): Promise<AiJobRecord> {
  return createAiJob("code_unique_annotations", request.projectId, request);
}

export async function waitForAiJobTerminalState(
  projectId: string,
  jobId: string,
  options?: {
    timeoutMs?: number;
    pollMs?: number;
    onProgress?: (job: AiJobRecord) => void;
  },
): Promise<AiJobRecord> {
  const timeoutMs = options?.timeoutMs ?? 10 * 60 * 1000;
  const pollMs = options?.pollMs ?? 1500;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const job = toAiJobRecordFromPostgres(await getPostgresAiJob(projectId, jobId));
    options?.onProgress?.(job);
    if (job.status === "completed" || job.status === "error") {
      return job;
    }
    await new Promise((resolve) => window.setTimeout(resolve, pollMs));
  }

  throw new Error("Timed out waiting for host AI processing.");
}

export async function cancelAiJob(
  projectId: string,
  jobId: string,
  message: string,
): Promise<void> {
  await cancelPostgresAiJob(projectId, jobId, message);
}
