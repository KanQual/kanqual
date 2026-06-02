import type PocketBase from "pocketbase";

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
  selectedContextMode: "prioritize" | "restrict";
  selectedDocumentIds: string[];
  selectedCaseIds: string[];
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
    documentId?: string | null;
    caseId?: string | null;
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
  pb: PocketBase,
  jobType: AiJobType,
  projectId: string,
  request: TRequest,
): Promise<AiJobRecord> {
  const record = await pb.collection(AI_JOB_COLLECTION).create({
    project: projectId,
    job_type: jobType,
    status: "queued",
    request_json: JSON.stringify(request),
    result_json: "",
    error_message: "",
    host_message: "Queued for host AI processing.",
    created_by: pb.authStore.record?.id ?? "",
    created_by_identifier: String(pb.authStore.record?.user_identifier ?? ""),
  });
  return toAiJobRecord(record);
}

export async function createProjectChatAiJob(
  pb: PocketBase,
  request: ProjectChatAiJobRequest,
): Promise<AiJobRecord> {
  return createAiJob(pb, "project_chat", request.projectId, request);
}

export async function createDocumentProcessingAiJob(
  pb: PocketBase,
  request: DocumentProcessingAiJobRequest,
): Promise<AiJobRecord> {
  return createAiJob(pb, "document_processing", request.projectId, request);
}

export async function createAttributeSuggestionAiJob(
  pb: PocketBase,
  request: AttributeSuggestionAiJobRequest,
): Promise<AiJobRecord> {
  return createAiJob(pb, "attribute_suggestions", request.projectId, request);
}

export async function createEmbeddingBuildAiJob(
  pb: PocketBase,
  request: EmbeddingBuildAiJobRequest,
): Promise<AiJobRecord> {
  return createAiJob(pb, "embedding_build", request.projectId, request);
}

export async function createRelevantSegmentsAiJob(
  pb: PocketBase,
  request: RelevantSegmentsAiJobRequest,
): Promise<AiJobRecord> {
  return createAiJob(pb, "relevant_segments_search", request.projectId, request);
}

export async function createCodeConceptualSummaryAiJob(
  pb: PocketBase,
  request: CodeAnalysisBaseAiJobRequest,
): Promise<AiJobRecord> {
  return createAiJob(pb, "code_conceptual_summary", request.projectId, request);
}

export async function createMostTypicalAnnotationAiJob(
  pb: PocketBase,
  request: CodeAnalysisBaseAiJobRequest,
): Promise<AiJobRecord> {
  return createAiJob(pb, "most_typical_annotation", request.projectId, request);
}

export async function createCodeDecompositionAiJob(
  pb: PocketBase,
  request: CodeAnalysisBaseAiJobRequest,
): Promise<AiJobRecord> {
  return createAiJob(pb, "code_decomposition", request.projectId, request);
}

export async function createCodePositionAiJob(
  pb: PocketBase,
  request: CodePositionAiJobRequest,
): Promise<AiJobRecord> {
  return createAiJob(pb, "code_position", request.projectId, request);
}

export async function createCodeUniqueAnnotationsAiJob(
  pb: PocketBase,
  request: CodeAnalysisBaseAiJobRequest,
): Promise<AiJobRecord> {
  return createAiJob(pb, "code_unique_annotations", request.projectId, request);
}

export async function waitForAiJobTerminalState(
  pb: PocketBase,
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
    const record = await pb.collection(AI_JOB_COLLECTION).getOne(jobId);
    const job = toAiJobRecord(record as unknown as Record<string, unknown>);
    options?.onProgress?.(job);
    if (job.status === "completed" || job.status === "error") {
      return job;
    }
    await new Promise((resolve) => window.setTimeout(resolve, pollMs));
  }

  throw new Error("Timed out waiting for host AI processing.");
}

export async function cancelAiJob(
  pb: PocketBase,
  jobId: string,
  message: string,
): Promise<void> {
  await pb.collection(AI_JOB_COLLECTION).update(jobId, {
    status: "error",
    error_message: message,
    host_message: message,
  });
}
