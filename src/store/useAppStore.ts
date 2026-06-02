import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import type {
  Project,
  Document,
  Case,
  Code,
  Annotation,
  Memo,
  ProjectUploadedFile,
  View,
  Role,
  ProjectLogEntry,
  PendingImportedUserResolution,
} from "../types";
import {
  clearLastProjectId,
  getLastProjectId,
  readAppSettings,
  rememberLastProjectId,
  type LlmSettings,
} from "../lib/appSettings";
import {
  assertActiveLlmRuntime,
  buildLlmInvokeRequestFields,
  hasConfiguredActiveLlm,
  hasSelectedActiveLlmModel,
} from "../lib/llmRuntime";
import {
  getAppRolePermissions,
  getProjectRolePermissions,
  hasPermission,
  normalizeAppRole,
  normalizeProjectRole,
  type Permission,
} from "../lib/permissions";
import {
  AI_JOB_COLLECTION,
  cancelAiJob,
  createAttributeSuggestionAiJob,
  createCodeConceptualSummaryAiJob,
  createCodeDecompositionAiJob,
  createCodePositionAiJob,
  createCodeUniqueAnnotationsAiJob,
  createDocumentProcessingAiJob,
  createEmbeddingBuildAiJob,
  createMostTypicalAnnotationAiJob,
  createProjectChatAiJob,
  createRelevantSegmentsAiJob,
  isLocalBackendUrl,
  toAiJobRecord,
  waitForAiJobTerminalState,
  type AttributeSuggestionAiJobRequest,
  type AttributeSuggestionAiJobResult,
  type CodeAnalysisBaseAiJobRequest,
  type CodeConceptualSummaryAiJobResult,
  type CodeDecompositionAiJobResult,
  type CodePositionAiJobRequest,
  type CodePositionAiJobResult,
  type CodeUniqueAnnotationsAiJobResult,
  type DocumentProcessingAiJobRequest,
  type EmbeddingBuildAiJobRequest,
  type MostTypicalAnnotationAiJobResult,
  type ProjectChatAiJobRequest,
  type ProjectChatAiJobResult,
  type RelevantSegmentsAiJobRequest,
  type RelevantSegmentsAiJobResult,
} from "../lib/aiJobs";
import { ensureSetup, getBackendIdentitySnapshot } from "../lib/pb";
import {
  PROJECT_UPLOADED_FILES_COLLECTION,
  buildUploadedFileStatusEvent,
  toProjectUploadedFile,
  type ProjectUploadedFileSourceKind,
  type ProjectUploadedFileStatus,
  type ProjectUploadedFileStatusEvent,
} from "../lib/projectUploadedFiles";
import { createProjectBackup } from "../lib/projectBackups";
import type {
  ProjectEmbeddingBuildItem,
  ProjectEmbeddingBuildStatus,
} from "../lib/projectEmbeddings";
import { buildProjectEmbeddingItems } from "../lib/projectEmbeddings";
import {
  DEFAULT_PROJECT_AI_ASSIST_SETTINGS,
  DEFAULT_PROJECT_AI_ASSIST_RUNTIME_STATUS,
  DEFAULT_PROJECT_DOCUMENT_IMPORT_SETTINGS,
  loadProjectAiAssistSettings,
  loadProjectSettingsSnapshot,
  projectAiAssistSettingsFromRecord,
  projectAiAssistRuntimeStatusFromRecord,
  projectDocumentImportSettingsFromRecord,
  saveProjectAiAssistSettings,
  saveProjectAiAssistRuntimeStatus,
  saveProjectDocumentImportSettings,
  type ProjectDocumentImportSettings,
  type ProjectAiAssistSettings,
  type ProjectAiAssistRuntimeStatus,
} from "../lib/projectSettings";

const RECENT_PROJECTS_KEY = "kq_recent_projects";

function rememberRecentProject(project: Project): void {
  try {
    const raw = localStorage.getItem(RECENT_PROJECTS_KEY);
    const current = raw ? JSON.parse(raw) as Array<Record<string, unknown>> : [];
    const next = [
      { id: project.id, name: project.name, description: project.description, openedAt: new Date().toISOString() },
      ...current.filter((item) => item.id !== project.id),
    ].slice(0, 25);
    localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(next));
  } catch {
    // Recent projects are a convenience only; never block opening a project.
  }
}

function forgetRecentProject(projectId: string): void {
  try {
    const raw = localStorage.getItem(RECENT_PROJECTS_KEY);
    if (!raw) return;
    const current = JSON.parse(raw) as Array<Record<string, unknown>>;
    const next = current.filter((item) => item.id !== projectId);
    localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(next));
  } catch {
    // Recent projects are a convenience only; never block project deletion.
  }
}

function isSnapshotTooLongError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybe = error as {
    response?: { data?: Record<string, { message?: string; code?: string }> };
  };
  const snapshotError = maybe.response?.data?.snapshot;
  const message = `${snapshotError?.message || ""} ${snapshotError?.code || ""}`.toLowerCase();
  return message.includes("no more than 5000") || message.includes("validation_max_text_constraint");
}

function describeUnknownError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

function sameProjectAiAssistRuntimeStatus(
  left: ProjectAiAssistRuntimeStatus,
  right: ProjectAiAssistRuntimeStatus,
): boolean {
  return (
    left.hostEmbeddingModelInstalled === right.hostEmbeddingModelInstalled
    && left.hostLlmEnabled === right.hostLlmEnabled
    && left.hostLlmModelSelected === right.hostLlmModelSelected
    && left.hostLlmConnectionLive === right.hostLlmConnectionLive
    && left.hostProjectEmbeddingsReady === right.hostProjectEmbeddingsReady
  );
}

function normalizeAnnotationIndexListResult(
  raw: unknown,
): Array<{ annotationIndex: number; reasoning: string }> {
  if (!raw || typeof raw !== "object") return [];
  const candidate = raw as Record<string, unknown>;
  const rows = Array.isArray(candidate.annotations)
    ? candidate.annotations
    : Array.isArray(candidate.items)
      ? candidate.items
      : Array.isArray(candidate.results)
        ? candidate.results
        : null;

  if (rows) {
    return rows
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const row = item as Record<string, unknown>;
        const rawIndex = row.annotationIndex ?? row.annotation_index ?? row.index ?? row.annotation;
        const annotationIndex = typeof rawIndex === "number"
          ? rawIndex
          : typeof rawIndex === "string"
            ? Number(rawIndex)
            : NaN;
        if (!Number.isFinite(annotationIndex)) return null;
        return {
          annotationIndex,
          reasoning: typeof row.reasoning === "string" ? row.reasoning : typeof row.reason === "string" ? row.reason : "",
        };
      })
      .filter((item): item is { annotationIndex: number; reasoning: string } => item !== null);
  }

  const rawIndex = candidate.annotationIndex ?? candidate.annotation_index ?? candidate.index ?? candidate.annotation;
  const annotationIndex = typeof rawIndex === "number"
    ? rawIndex
    : typeof rawIndex === "string"
      ? Number(rawIndex)
      : NaN;
  if (!Number.isFinite(annotationIndex)) return [];
  return [{
    annotationIndex,
    reasoning: typeof candidate.reasoning === "string" ? candidate.reasoning : typeof candidate.reason === "string" ? candidate.reason : "",
  }];
}

function normalizeMostTypicalAnnotationAiJobResult(raw: unknown): MostTypicalAnnotationAiJobResult {
  const candidate = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    annotations: normalizeAnnotationIndexListResult(raw),
    model: typeof candidate.model === "string" ? candidate.model : "",
  };
}

function normalizeCodeUniqueAnnotationsAiJobResult(raw: unknown): CodeUniqueAnnotationsAiJobResult {
  const candidate = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    annotations: normalizeAnnotationIndexListResult(raw),
    model: typeof candidate.model === "string" ? candidate.model : "",
  };
}

type ProcessingSegmentType = "metadata" | "question" | "answer";

type DocumentProcessingSegment = {
  segmentType: ProcessingSegmentType;
  speakerId: string;
  startOffset: number;
  endOffset: number;
  sortOrder: number;
  text: string;
  chunkIndex: number;
};

type DocumentProcessingProperNameCandidate = {
  text: string;
  sourceType: string;
};

type DocumentProcessingChunkManifest = {
  version: 1;
  model: string;
  numCtx: number;
  temperature: number;
  contentHash: string;
  totalChunks: number;
  chunks: Array<{
    chunkIndex: number;
    status: "pending" | "running" | "completed" | "error";
    attempts: number;
    error?: string;
  }>;
};

type DocumentProcessingAggregate = {
  processedContent: string;
  segments: DocumentProcessingSegment[];
  properNameCandidates: DocumentProcessingProperNameCandidate[];
};

function parseJsonString<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function splitDocumentProcessingChunks(content: string, numCtx: number): Array<{ chunkIndex: number; text: string }> {
  const chunkChars = Math.max((Math.max(0, numCtx - 900)) * 4, 4000);
  const chunks: Array<{ chunkIndex: number; text: string }> = [];
  let remaining = content.trim();
  while (remaining) {
    if (Array.from(remaining).length <= chunkChars) {
      chunks.push({ chunkIndex: chunks.length, text: remaining });
      break;
    }
    let codeUnitLimit = 0;
    let charCount = 0;
    for (const char of remaining) {
      codeUnitLimit += char.length;
      charCount += 1;
      if (charCount >= chunkChars) break;
    }
    const candidate = remaining.slice(0, codeUnitLimit);
    const splitAt = Math.max(
      candidate.lastIndexOf("\n\n") >= 0
        ? candidate.lastIndexOf("\n\n") + 2
        : candidate.lastIndexOf("\n") >= 0
          ? candidate.lastIndexOf("\n") + 1
          : codeUnitLimit,
      1,
    );
    const chunk = remaining.slice(0, splitAt);
    if (chunk.trim()) {
      chunks.push({ chunkIndex: chunks.length, text: chunk });
    }
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}

async function hashDocumentProcessingContent(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createInitialChunkManifest(input: {
  contentHash: string;
  model: string;
  numCtx: number;
  temperature: number;
  totalChunks: number;
}): DocumentProcessingChunkManifest {
  return {
    version: 1,
    contentHash: input.contentHash,
    model: input.model,
    numCtx: input.numCtx,
    temperature: input.temperature,
    totalChunks: input.totalChunks,
    chunks: Array.from({ length: input.totalChunks }, (_, chunkIndex) => ({
      chunkIndex,
      status: "pending" as const,
      attempts: 0,
    })),
  };
}

function appendChunkAggregate(
  aggregate: DocumentProcessingAggregate,
  response: {
    processedContent: string;
    segments: unknown[];
    properNameCandidates: unknown[];
    chunkIndex: number;
  },
): DocumentProcessingAggregate {
  const baseOffset = aggregate.processedContent ? aggregate.processedContent.length + 2 : 0;
  const rebasedSegments = (response.segments as Array<Record<string, unknown>>).map((segment, index) => ({
    segmentType: segment.segmentType === "metadata" || segment.segmentType === "question" ? segment.segmentType : "answer",
    speakerId: typeof segment.speakerId === "string" ? segment.speakerId : "",
    startOffset: baseOffset + Number(segment.startOffset ?? 0),
    endOffset: baseOffset + Number(segment.endOffset ?? 0),
    sortOrder: aggregate.segments.length + index,
    text: typeof segment.text === "string" ? segment.text : "",
    chunkIndex: response.chunkIndex,
  })) satisfies DocumentProcessingSegment[];
  const properNameMap = new Map<string, DocumentProcessingProperNameCandidate>();
  for (const candidate of aggregate.properNameCandidates) {
    properNameMap.set(candidate.text.trim().toLowerCase(), candidate);
  }
  for (const candidate of response.properNameCandidates as Array<Record<string, unknown>>) {
    const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
    if (!text) continue;
    properNameMap.set(text.toLowerCase(), {
      text,
      sourceType: typeof candidate.sourceType === "string" ? candidate.sourceType : "text",
    });
  }
  return {
    processedContent: aggregate.processedContent
      ? `${aggregate.processedContent}\n\n${response.processedContent}`
      : response.processedContent,
    segments: [...aggregate.segments, ...rebasedSegments],
    properNameCandidates: [...properNameMap.values()],
  };
}

function mergeDocumentProcessingSegments(segments: DocumentProcessingSegment[]): DocumentProcessingSegment[] {
  const merged: DocumentProcessingSegment[] = [];
  for (const segment of segments) {
    const text = segment.text.trim();
    if (!text) continue;
    const normalizedSegment = { ...segment, text };
    const last = merged[merged.length - 1];
    if (
      last
      && last.chunkIndex !== normalizedSegment.chunkIndex
      && last.segmentType === normalizedSegment.segmentType
      && last.speakerId.trim().toLowerCase() === normalizedSegment.speakerId.trim().toLowerCase()
    ) {
      last.text = `${last.text}\n\n${normalizedSegment.text}`;
      continue;
    }
    merged.push(normalizedSegment);
  }
  let cursor = 0;
  return merged.map((segment, index) => {
    const startOffset = cursor;
    const endOffset = startOffset + segment.text.length;
    cursor = endOffset + 2;
    return { ...segment, startOffset, endOffset, sortOrder: index };
  });
}

function buildProcessedContentFromSegments(segments: DocumentProcessingSegment[]): string {
  return segments.map((segment) => segment.text).join("\n\n");
}

function collectProcessingProperNameCandidates(
  segments: DocumentProcessingSegment[],
  existing: DocumentProcessingProperNameCandidate[],
): DocumentProcessingProperNameCandidate[] {
  const properNameMap = new Map<string, DocumentProcessingProperNameCandidate>();
  for (const candidate of existing) {
    const text = candidate.text.trim();
    if (!text) continue;
    properNameMap.set(text.toLowerCase(), { text, sourceType: candidate.sourceType || "text" });
  }
  for (const segment of segments) {
    const speakerId = segment.speakerId.trim();
    if (!speakerId) continue;
    if (!/[A-Za-z]/.test(speakerId) || !/[a-z]/.test(speakerId)) continue;
    properNameMap.set(speakerId.toLowerCase(), { text: speakerId, sourceType: "speaker" });
  }
  return [...properNameMap.values()];
}

// ─── Map PocketBase records to our typed model ───────────────────────────────

function toProject(r: RecordModel): Project {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    createdAt: r.created,
    updatedAt: r.updated,
  };
}

function toDocument(r: RecordModel): Document {
  return {
    id: r.id,
    projectId: r.project,
    name: r.name,
    type: String(r.type ?? "Text"),
    filePath: r.file_path ?? "",
    content: r.content ?? "",
    structuredContentJson: String(r.structured_content_json ?? ""),
    importedAt: r.created,
  };
}

function toCase(r: RecordModel): Case {
  return {
    id: r.id,
    projectId: r.project,
    name: r.name,
    notes: r.notes ?? "",
    createdAt: r.created,
    updatedAt: r.updated,
  };
}

function toCode(r: RecordModel): Code {
  return {
    id: r.id,
    projectId: r.project,
    label: r.label,
    color: r.color,
    description: r.description ?? "",
    shortcut: r.shortcut ?? undefined,
    parentId: r.parent || undefined,
  };
}

function toAnnotation(r: RecordModel): Annotation {
  const cb = r.expand?.created_by;
  return {
    id: r.id,
    documentId: r.document,
    codeId: r.code,
    startOffset: r.start_offset,
    endOffset: r.end_offset,
    quote: r.quote,
    note: r.note ?? "",
    createdAt: r.created,
    createdBy: cb?.name || cb?.email || "",
    createdById: cb?.id || r.created_by || "",
  };
}

function toLogEntry(r: RecordModel): ProjectLogEntry {
  return {
    id: r.id,
    projectId: r.project,
    userId: r.user,
    userName: r.user_name ?? "",
    accessMode: r.access_mode === "remote" ? "remote" : r.access_mode === "local" ? "local" : undefined,
    action: r.action,
    label: r.label,
    recordId: r.record_id || undefined,
    occurredAt: r.occurred_at,
    restoredAt: r.restored_at || undefined,
  };
}

function getProjectLogAccessMode(baseUrl: string): "local" | "remote" {
  try {
    const url = new URL(baseUrl);
    const host = url.hostname.toLowerCase();
    if (host === "127.0.0.1" || host === "localhost" || host === "::1") {
      return "local";
    }
  } catch {
    // Fall back to remote for any unparseable or unexpected URL.
  }
  return "remote";
}

function toMemo(r: RecordModel): Memo {
  return {
    id: r.id,
    projectId: r.project,
    documentId: r.document || undefined,
    annotationId: r.annotation || undefined,
    title: r.title,
    body: r.body ?? "",
    createdAt: r.created,
    updatedAt: r.updated,
  };
}

type DocumentLockInfo = {
  id: string;
  documentId: string;
  documentName: string;
  userId: string;
  userName: string;
  expiresAtMs: number;
  reason?: "locked" | "kicked";
};

type EmbeddingBuildStartRequest = {
  projectId: string;
  llmSettings: Pick<LlmSettings, "batchSize" | "chunkSize" | "overlapSize" | "prefixPassages" | "normalizeWhitespace">;
  items: ProjectEmbeddingBuildItem[];
  pendingAiAssistEnable?: {
    projectId: string;
    settings: ProjectAiAssistSettings;
  };
  successLog?: {
    projectId: string;
    action: string;
    label: string;
  };
};

type DocumentProcessingReviewLensId = "speaker-segmentation" | "named-entity-extraction";

type DocumentProcessingRequest = {
  projectId: string;
  documentIds: string[];
  reviewLenses: Record<DocumentProcessingReviewLensId, boolean>;
  restartDocumentIds?: string[];
};

type BackgroundDocumentProcessingStatus = {
  phase: "idle" | "running" | "completed" | "error";
  projectId: string | null;
  completedDocuments: number;
  totalDocuments: number;
  currentDocumentName: string;
  message: string;
  error?: string;
  failures?: Array<{
    documentName: string;
    message: string;
  }>;
  currentChunkIndex?: number;
  currentChunkTotal?: number;
};

type PendingNewMemoContext = {
  annotationIds?: string[];
};

type AiCodingRelevantSegmentsSession = {
  searching: boolean;
  lockedCodeId: string | null;
  results: RelevantSegmentsAiJobResult["segments"];
  lastModel: string;
  searchError: string;
  searchNotice: string;
};

type EmbeddingModelDownloadStatus = {
  phase: "idle" | "downloading" | "cancelling" | "cancelled" | "completed" | "error";
  downloadedBytes: number;
  totalBytes: number | null;
  downloadedFiles: number;
  totalFiles: number;
  currentFile: string | null;
  progressPercent: number | null;
  message: string | null;
};

type EmbeddingModelDownloadPreflight = {
  installed: boolean;
  modelDir: string;
  totalBytes: number;
  existingBytes: number;
  remainingBytes: number;
  totalFiles: number | null;
  existingFiles: number;
  remainingFiles: number | null;
  manifestAvailable: boolean;
  message: string | null;
};

const DOCUMENT_LOCK_LEASE_MS = 45_000;
const DOCUMENT_LOCK_HEARTBEAT_MS = 15_000;
const DOCUMENT_LOCK_KICK_WINDOW_MS = 120_000;
const DOCUMENT_LOCKING_VIEWS: View[] = ["documents", "code-text", "ai-assisted-coding"];

function toDocumentLockInfo(record: RecordModel, documentName = ""): DocumentLockInfo {
  return {
    id: record.id,
    documentId: record.document,
    documentName,
    userId: record.user,
    userName: String(record.user_name ?? ""),
    expiresAtMs: Number(record.expires_at_ms ?? 0),
    reason: "locked",
  };
}

async function fetchOwnerMap(pb: PocketBase, projectIds: string[]): Promise<Record<string, string>> {
  if (projectIds.length === 0) return {};
  const filter = projectIds.map((id) => `project="${id}"`).join("||");
  const owners = await pb.collection("project_members").getFullList({
    filter: `(${filter})&&role="owner"`,
    expand: "user",
  });
  return Object.fromEntries(
    owners.map((m) => [m.project, m.expand?.user?.name || m.expand?.user?.email || "Unknown"])
  );
}

// ─── Store ───────────────────────────────────────────────────────────────────

export function useAppStore(pb: PocketBase) {
  const [view, setView] = useState<View>("projects");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [userRole, setUserRole] = useState<Role | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [projectUploadedFiles, setProjectUploadedFiles] = useState<ProjectUploadedFile[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const [activeDocument, setActiveDocument] = useState<Document | null>(null);
  const [activeDocumentLock, setActiveDocumentLock] = useState<DocumentLockInfo | null>(null);
  const [documentLockConflict, setDocumentLockConflict] = useState<DocumentLockInfo | null>(null);
  const activeDocumentLockRef = useRef<DocumentLockInfo | null>(null);
  const [codes, setCodes] = useState<Code[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [pendingDocId,  setPendingDocId]  = useState<string | null>(null);
  const [pendingAnnId,  setPendingAnnId]  = useState<string | null>(null);
  const [pendingCodeId, setPendingCodeId] = useState<string | null>(null);
  const [pendingTextCitation, setPendingTextCitation] = useState<{
    documentId: string;
    startOffset: number;
    endOffset: number;
    label?: string;
  } | null>(null);
  const [aiCodingRelevantSegmentsSessions, setAiCodingRelevantSegmentsSessions] =
    useState<Record<string, AiCodingRelevantSegmentsSession>>({});
  const [pendingMemoId, setPendingMemoId] = useState<string | null>(null);
  const [pendingNewMemoContext, setPendingNewMemoContext] = useState<PendingNewMemoContext | null>(null);
  const [pendingCaseId, setPendingCaseId] = useState<string | null>(null);
  const [pendingImportedUserResolution, setPendingImportedUserResolution] =
    useState<PendingImportedUserResolution | null>(null);
  const [logEntries,    setLogEntries]    = useState<ProjectLogEntry[]>([]);
  const [networkMode,   setNetworkModeState] = useState<"local" | "lan">("local");
  const [projectEmbeddingBuildStatus, setProjectEmbeddingBuildStatus] =
    useState<ProjectEmbeddingBuildStatus | null>(null);
  const [projectEmbeddingBuildBannerOpen, setProjectEmbeddingBuildBannerOpen] = useState(false);
  const projectEmbeddingRemoteJobRef = useRef<Promise<void> | null>(null);
  const [projectAiAssistSettings, setProjectAiAssistSettings] = useState<ProjectAiAssistSettings>(
    DEFAULT_PROJECT_AI_ASSIST_SETTINGS,
  );
  const [projectAiAssistRuntimeStatus, setProjectAiAssistRuntimeStatus] = useState<ProjectAiAssistRuntimeStatus>(
    DEFAULT_PROJECT_AI_ASSIST_RUNTIME_STATUS,
  );
  const projectAiAssistRuntimeStatusRef = useRef<ProjectAiAssistRuntimeStatus>(DEFAULT_PROJECT_AI_ASSIST_RUNTIME_STATUS);
  const [projectAiAssistSettingsLoading, setProjectAiAssistSettingsLoading] = useState(false);
  const [projectDocumentImportSettings, setProjectDocumentImportSettings] = useState<ProjectDocumentImportSettings>(
    DEFAULT_PROJECT_DOCUMENT_IMPORT_SETTINGS,
  );
  const [documentProcessingStatus, setDocumentProcessingStatus] =
    useState<BackgroundDocumentProcessingStatus | null>(null);
  const [documentProcessingBannerOpen, setDocumentProcessingBannerOpen] = useState(false);
  const [embeddingModelDownloadStatus, setEmbeddingModelDownloadStatus] =
    useState<EmbeddingModelDownloadStatus | null>(null);
  const [embeddingModelDownloadPreflight, setEmbeddingModelDownloadPreflight] =
    useState<EmbeddingModelDownloadPreflight | null>(null);
  const [embeddingModelDownloadBannerOpen, setEmbeddingModelDownloadBannerOpen] = useState(false);
  const projectEmbeddingPendingEnableRef = useRef<EmbeddingBuildStartRequest["pendingAiAssistEnable"] | null>(null);
  const projectEmbeddingSuccessLogRef = useRef<EmbeddingBuildStartRequest["successLog"] | null>(null);
  const projectEmbeddingLastPhaseRef = useRef<ProjectEmbeddingBuildStatus["phase"] | null>(null);
  const embeddingModelDownloadLastPhaseRef = useRef<EmbeddingModelDownloadStatus["phase"] | null>(null);
  const embeddingModelDownloadJobRef = useRef<Promise<void> | null>(null);
  const documentProcessingJobRef = useRef<Promise<void> | null>(null);
  const aiJobWorkerRunningRef = useRef(false);
  const startupRestoreAttempted = useRef(false);
  const appRole = normalizeAppRole(pb.authStore.record?.app_role);
  const isAdministrator = appRole === "administrator";

  const projectPermissions = getProjectRolePermissions(userRole);
  const appPermissions = getAppRolePermissions(appRole);
  const canCurrentUser = useCallback(
    (permission: Permission) => hasPermission({ appRole, projectRole: userRole, permission }),
    [appRole, userRole]
  );

  useEffect(() => {
    activeDocumentLockRef.current = activeDocumentLock;
  }, [activeDocumentLock]);

  useEffect(() => {
    projectAiAssistRuntimeStatusRef.current = projectAiAssistRuntimeStatus;
  }, [projectAiAssistRuntimeStatus]);

  // ── Logging ───────────────────────────────────────────────────────────────

  const logAction = useCallback(
    async (projectId: string, action: string, label: string, recordId?: string) => {
      const uid  = pb.authStore.record?.id;
      const name = pb.authStore.record?.name || pb.authStore.record?.email || "";
      try {
        const r = await pb.collection("project_log").create({
          project:     projectId,
          user:        uid,
          user_identifier: pb.authStore.record?.user_identifier || "",
          user_name:   name,
          access_mode: getProjectLogAccessMode(pb.baseURL),
          action,
          label,
          record_id:   recordId ?? "",
        });
        const entry = toLogEntry(r);
        setLogEntries((prev) => (prev.some((existing) => existing.id === entry.id) ? prev : [entry, ...prev]));
      } catch {
        // logging failures must never break normal app flow
      }
    },
    [pb]
  );

  const runProjectChatRequestLocally = useCallback(
    async (request: ProjectChatAiJobRequest): Promise<ProjectChatAiJobResult> => {
      const llmSettings = readAppSettings().llm;
      assertActiveLlmRuntime(llmSettings, "using project chat");
      return invoke<ProjectChatAiJobResult>("chat_with_project_ollama", {
        request: {
          projectId: request.projectId,
          query: request.query,
          conversation: request.conversation,
          ...buildLlmInvokeRequestFields(llmSettings),
          prefixQueries: llmSettings.prefixQueries,
          selectedContextMode: request.selectedContextMode,
          selectedDocumentIds: request.selectedDocumentIds,
          selectedCaseIds: request.selectedCaseIds,
          selectedCodeIds: request.selectedCodeIds,
          selectedAnnotationIds: request.selectedAnnotationIds,
          selectedMemoIds: request.selectedMemoIds,
        },
      });
    },
    [],
  );

  const getHostLlmSettingsOrThrow = useCallback((): LlmSettings => {
    const llmSettings = readAppSettings().llm;
    assertActiveLlmRuntime(llmSettings, "using AI Assist");
    return llmSettings;
  }, []);

  const processDocumentsWithHostRuntime = useCallback(
    async (
      request: DocumentProcessingAiJobRequest,
      onProgress?: (status: {
        completedDocuments: number;
        totalDocuments: number;
        currentDocumentName: string;
        message: string;
        failures: Array<{ documentName: string; message: string }>;
        currentChunkIndex?: number;
        currentChunkTotal?: number;
      }) => Promise<void> | void,
    ) => {
      const llmSettings = readAppSettings().llm;
      const runtime = assertActiveLlmRuntime(llmSettings, "processing documents");

      const selectedDocuments = (
        await Promise.all(
          request.documentIds.map(async (documentId) => {
            try {
              const record = await pb.collection("documents").getOne(documentId);
              if (record.project !== request.projectId || record.deleted_at) return null;
              return {
                id: record.id,
                name: String(record.name ?? "Untitled document"),
                filePath: String(record.file_path ?? ""),
                content: String(record.content ?? ""),
              };
            } catch {
              return null;
            }
          }),
        )
      ).filter((document): document is { id: string; name: string; filePath: string; content: string } => Boolean(document));

      if (selectedDocuments.length === 0) {
        throw new Error("Select at least one document to process.");
      }

      const interDocumentCooldownMs = 10_000;
      const failures: Array<{ documentName: string; message: string }> = [];
      for (let index = 0; index < selectedDocuments.length; index += 1) {
        const document = selectedDocuments[index];
        const forceRestart = request.restartDocumentIds?.includes(document.id) ?? false;
        await onProgress?.({
          completedDocuments: index,
          totalDocuments: selectedDocuments.length,
          currentDocumentName: document.name,
          message: `${forceRestart ? "Restarting" : "Processing"} ${document.name} (${index + 1} of ${selectedDocuments.length}).`,
          failures: [...failures],
        });

        try {
          const chunks = splitDocumentProcessingChunks(document.content, llmSettings.ollamaNumCtx);
          if (chunks.length === 0) {
            throw new Error("The document has no content to process.");
          }
          const sourceContentHash = await hashDocumentProcessingContent(document.content);
          const existing = await pb.collection("processed_document_reviews").getFirstListItem(
            `project="${request.projectId}"&&document="${document.id}"&&deleted_at=""`,
          ).catch(() => null);
          const resumableManifest = existing
            ? parseJsonString<DocumentProcessingChunkManifest | null>(existing.chunk_manifest_json, null)
            : null;
          const canResume = !forceRestart && Boolean(
            existing
            && existing.source_content_hash === sourceContentHash
            && String(existing.model ?? "") === runtime.model
            && Number(existing.chunk_count ?? 0) === chunks.length
            && resumableManifest
            && resumableManifest.contentHash === sourceContentHash
            && resumableManifest.model === runtime.model
            && resumableManifest.numCtx === llmSettings.ollamaNumCtx
            && resumableManifest.temperature === llmSettings.ollamaTemperature,
          );
          const manifest = canResume && resumableManifest
            ? resumableManifest
            : createInitialChunkManifest({
              contentHash: sourceContentHash,
              model: runtime.model,
              numCtx: llmSettings.ollamaNumCtx,
              temperature: llmSettings.ollamaTemperature,
              totalChunks: chunks.length,
            });
          let aggregate: DocumentProcessingAggregate = canResume && existing
            ? {
              processedContent: String(existing.processed_content ?? ""),
              segments: parseJsonString<DocumentProcessingSegment[]>(existing.segments_json, []),
              properNameCandidates: parseJsonString<DocumentProcessingProperNameCandidate[]>(
                existing.proper_name_candidates_json,
                [],
              ),
            }
            : {
              processedContent: "",
              segments: [],
              properNameCandidates: [],
            };
          let reviewRecordId = typeof existing?.id === "string" ? existing.id : "";
          const basePayload = {
            project: request.projectId,
            document: document.id,
            document_name: document.name,
            file_path: document.filePath,
            status: forceRestart ? "pending_review" : existing?.status === "reviewed" ? "reviewed" : "pending_review",
            model: runtime.model,
            base_url: runtime.baseUrl,
            chunk_count: chunks.length,
            processed_chunk_count: canResume ? manifest.chunks.filter((chunk) => chunk.status === "completed").length : 0,
            processing_status: "running",
            processing_error: "",
            chunk_manifest_json: JSON.stringify(manifest),
            processing_started_at: forceRestart ? new Date().toISOString() : String(existing?.processing_started_at ?? new Date().toISOString()),
            processing_completed_at: "",
            last_processed_chunk_index: canResume
              ? Math.max(-1, ...manifest.chunks.filter((chunk) => chunk.status === "completed").map((chunk) => chunk.chunkIndex))
              : -1,
            source_content_hash: sourceContentHash,
            processed_content: aggregate.processedContent,
            segments_json: JSON.stringify(aggregate.segments),
            proper_name_candidates_json: JSON.stringify(aggregate.properNameCandidates),
            enabled_review_lenses_json: JSON.stringify(request.reviewLenses),
            exported_to_project: forceRestart ? false : Boolean(existing?.exported_to_project),
            created_by: pb.authStore.record?.id ?? "",
            created_by_identifier: String(pb.authStore.record?.user_identifier ?? ""),
            deleted_at: "",
          };
          if (reviewRecordId) {
            await pb.collection("processed_document_reviews").update(reviewRecordId, basePayload);
          } else {
            const created = await pb.collection("processed_document_reviews").create(basePayload);
            reviewRecordId = created.id;
          }

          let lastCompletedChunkIndex = canResume
            ? Math.max(-1, ...manifest.chunks.filter((chunk) => chunk.status === "completed").map((chunk) => chunk.chunkIndex))
            : -1;
          for (let chunkIndex = lastCompletedChunkIndex + 1; chunkIndex < chunks.length; chunkIndex += 1) {
            const manifestChunk = manifest.chunks[chunkIndex];
            if (!manifestChunk) continue;
            manifestChunk.status = "running";
            manifestChunk.attempts += 1;
            delete manifestChunk.error;
            await pb.collection("processed_document_reviews").update(reviewRecordId, {
              processing_status: "running",
              processing_error: "",
              chunk_manifest_json: JSON.stringify(manifest),
              processed_chunk_count: manifest.chunks.filter((chunk) => chunk.status === "completed").length,
              last_processed_chunk_index: lastCompletedChunkIndex,
            });
            await onProgress?.({
              completedDocuments: index,
              totalDocuments: selectedDocuments.length,
              currentDocumentName: document.name,
              currentChunkIndex: chunkIndex + 1,
              currentChunkTotal: chunks.length,
              message: `${forceRestart ? "Restarting" : canResume ? "Resuming" : "Processing"} ${document.name} chunk ${chunkIndex + 1} of ${chunks.length} (${index + 1} of ${selectedDocuments.length} documents).`,
              failures: [...failures],
            });
            try {
              const response = await invoke<{
                processedContent: string;
                segments: unknown[];
                properNameCandidates: unknown[];
                model: string;
                baseUrl: string;
                chunkIndex: number;
              }>("process_document_chunk_with_ollama", {
                request: {
                  chunkText: chunks[chunkIndex]?.text ?? "",
                  chunkIndex,
                  ...buildLlmInvokeRequestFields(llmSettings),
                  timeoutSeconds: llmSettings.ollamaDocumentProcessingTimeoutSeconds,
                },
              });
              aggregate = appendChunkAggregate(aggregate, response);
              manifestChunk.status = "completed";
              lastCompletedChunkIndex = chunkIndex;
              await pb.collection("processed_document_reviews").update(reviewRecordId, {
                model: response.model,
                base_url: response.baseUrl,
                processed_chunk_count: manifest.chunks.filter((chunk) => chunk.status === "completed").length,
                processing_status: chunkIndex === chunks.length - 1 ? "completed" : "running",
                processing_error: "",
                chunk_manifest_json: JSON.stringify(manifest),
                last_processed_chunk_index: chunkIndex,
                processed_content: aggregate.processedContent,
                segments_json: JSON.stringify(aggregate.segments),
                proper_name_candidates_json: JSON.stringify(aggregate.properNameCandidates),
              });
            } catch (error) {
              manifestChunk.status = "error";
              manifestChunk.error = error instanceof Error && error.message.trim()
                ? error.message
                : typeof error === "string" && error.trim()
                  ? error
                  : "Could not process this document chunk.";
              await pb.collection("processed_document_reviews").update(reviewRecordId, {
                processed_chunk_count: manifest.chunks.filter((chunk) => chunk.status === "completed").length,
                processing_status: lastCompletedChunkIndex >= 0 ? "partial" : "error",
                processing_error: manifestChunk.error,
                chunk_manifest_json: JSON.stringify(manifest),
                last_processed_chunk_index: lastCompletedChunkIndex,
                processed_content: aggregate.processedContent,
                segments_json: JSON.stringify(aggregate.segments),
                proper_name_candidates_json: JSON.stringify(aggregate.properNameCandidates),
              });
              throw error;
            }
          }

          const mergedSegments = mergeDocumentProcessingSegments(aggregate.segments);
          const finalProcessedContent = buildProcessedContentFromSegments(mergedSegments);
          const finalProperNameCandidates = collectProcessingProperNameCandidates(
            mergedSegments,
            aggregate.properNameCandidates,
          );
          await pb.collection("processed_document_reviews").update(reviewRecordId, {
            status: existing?.status === "reviewed" ? "reviewed" : "pending_review",
            model: runtime.model,
            chunk_count: chunks.length,
            processed_chunk_count: chunks.length,
            processing_status: "completed",
            processing_error: "",
            processing_completed_at: new Date().toISOString(),
            chunk_manifest_json: JSON.stringify(manifest),
            last_processed_chunk_index: chunks.length - 1,
            source_content_hash: sourceContentHash,
            processed_content: finalProcessedContent,
            segments_json: JSON.stringify(mergedSegments),
            proper_name_candidates_json: JSON.stringify(finalProperNameCandidates),
            enabled_review_lenses_json: JSON.stringify(request.reviewLenses),
          });
        } catch (error) {
          failures.push({
            documentName: document.name,
            message: error instanceof Error && error.message.trim()
              ? error.message
              : typeof error === "string" && error.trim()
                ? error
                : "Could not process this document.",
          });
        }

        await onProgress?.({
          completedDocuments: index + 1,
          totalDocuments: selectedDocuments.length,
          currentDocumentName: document.name,
          message: `Processed ${index + 1} of ${selectedDocuments.length} document${selectedDocuments.length === 1 ? "" : "s"}.`,
          failures: [...failures],
        });

        if (index < selectedDocuments.length - 1) {
          const nextDocument = selectedDocuments[index + 1];
          await onProgress?.({
            completedDocuments: index + 1,
            totalDocuments: selectedDocuments.length,
            currentDocumentName: nextDocument.name,
            message: `Cooling down for 10 seconds before processing ${nextDocument.name} (${index + 2} of ${selectedDocuments.length}).`,
            failures: [...failures],
          });
          await new Promise((resolve) => window.setTimeout(resolve, interDocumentCooldownMs));
        }
      }

      return {
        totalDocuments: selectedDocuments.length,
        processedDocuments: selectedDocuments.length - failures.length,
        failures,
      };
    },
    [pb],
  );

  const runProjectChat = useCallback(
    async (request: ProjectChatAiJobRequest, onProgress?: (message: string) => void): Promise<ProjectChatAiJobResult> => {
      if (isLocalBackendUrl(pb.baseURL)) {
        return runProjectChatRequestLocally(request);
      }
      onProgress?.("Queued for host AI processing...");
      const job = await createProjectChatAiJob(pb, request);
      const terminal = await waitForAiJobTerminalState(pb, job.id, {
        onProgress: (currentJob) => onProgress?.(currentJob.hostMessage || "Waiting for host AI processing..."),
      });
      if (terminal.status === "error") {
        throw new Error(terminal.errorMessage || "Host AI processing failed.");
      }
      return JSON.parse(terminal.resultJson) as ProjectChatAiJobResult;
    },
    [pb, runProjectChatRequestLocally],
  );

  const runAttributeSuggestionsLocally = useCallback(
    async (request: AttributeSuggestionAiJobRequest): Promise<AttributeSuggestionAiJobResult> => {
      const llmSettings = getHostLlmSettingsOrThrow();
      return invoke<AttributeSuggestionAiJobResult>("generate_attribute_value_suggestions_with_ollama", {
        request: {
          runId: request.runId,
          attributeName: request.attributeName,
          attributeDataType: request.attributeDataType,
          attributeDescription: request.attributeDescription,
          attributeOptions: request.attributeOptions,
          items: request.items,
          ...buildLlmInvokeRequestFields(llmSettings),
        },
      });
    },
    [getHostLlmSettingsOrThrow],
  );

  const runAttributeSuggestions = useCallback(
    async (
      request: AttributeSuggestionAiJobRequest,
      onProgress?: (message: string) => void,
      onJobQueued?: (jobId: string) => void,
    ): Promise<AttributeSuggestionAiJobResult> => {
      if (isLocalBackendUrl(pb.baseURL)) {
        return runAttributeSuggestionsLocally(request);
      }
      onProgress?.("Queued for host AI processing...");
      const job = await createAttributeSuggestionAiJob(pb, request);
      onJobQueued?.(job.id);
      const terminal = await waitForAiJobTerminalState(pb, job.id, {
        timeoutMs: 20 * 60 * 1000,
        onProgress: (currentJob) => onProgress?.(currentJob.hostMessage || "Waiting for host AI processing..."),
      });
      if (terminal.status === "error") {
        throw new Error(terminal.errorMessage || "Host AI processing failed.");
      }
      return JSON.parse(terminal.resultJson) as AttributeSuggestionAiJobResult;
    },
    [pb, runAttributeSuggestionsLocally],
  );

  const cancelAttributeSuggestionRun = useCallback(
    async (runId: string, jobId?: string | null) => {
      const message = "Attribute suggestion generation was stopped.";
      if (isLocalBackendUrl(pb.baseURL)) {
        await invoke("cancel_attribute_suggestion_run", { runId });
        return;
      }
      if (!jobId) return;
      await cancelAiJob(pb, jobId, message);
    },
    [pb],
  );

  const runRelevantSegmentSearchLocally = useCallback(
    async (request: RelevantSegmentsAiJobRequest): Promise<RelevantSegmentsAiJobResult> => {
      const llmSettings = getHostLlmSettingsOrThrow();
      return invoke<RelevantSegmentsAiJobResult>("find_relevant_project_segments_with_ollama", {
        request: {
          projectId: request.projectId,
          activeDocumentId: request.activeDocumentId,
          codeId: request.codeId,
          codeLabel: request.codeLabel,
          codeDescription: request.codeDescription,
          ...buildLlmInvokeRequestFields(llmSettings),
          candidateLimit: llmSettings.ollamaRelevantSegmentsCandidateLimit,
          maxResults: llmSettings.ollamaRelevantSegmentsMaxResults,
          prefixQueries: llmSettings.prefixQueries,
        },
      });
    },
    [getHostLlmSettingsOrThrow],
  );

  const runRelevantSegmentSearch = useCallback(
    async (request: RelevantSegmentsAiJobRequest, onProgress?: (message: string) => void): Promise<RelevantSegmentsAiJobResult> => {
      if (isLocalBackendUrl(pb.baseURL)) {
        return runRelevantSegmentSearchLocally(request);
      }
      onProgress?.("Queued for host AI processing...");
      const job = await createRelevantSegmentsAiJob(pb, request);
      const terminal = await waitForAiJobTerminalState(pb, job.id, {
        timeoutMs: 20 * 60 * 1000,
        onProgress: (currentJob) => onProgress?.(currentJob.hostMessage || "Waiting for host AI processing..."),
      });
      if (terminal.status === "error") {
        throw new Error(terminal.errorMessage || "Host AI processing failed.");
      }
      return JSON.parse(terminal.resultJson) as RelevantSegmentsAiJobResult;
    },
    [pb, runRelevantSegmentSearchLocally],
  );

  const startAiCodingRelevantSegmentsSearch = useCallback(
    async (request: RelevantSegmentsAiJobRequest & { documentName?: string | null }) => {
      const documentId = request.activeDocumentId;
      const codeLabel = request.codeLabel;
      setAiCodingRelevantSegmentsSessions((prev) => ({
        ...prev,
        [documentId]: {
          searching: true,
          lockedCodeId: request.codeId,
          results: prev[documentId]?.results ?? [],
          lastModel: prev[documentId]?.lastModel ?? "",
          searchError: "",
          searchNotice: `The configured LLM is reviewing indexed segments from the open document for "${codeLabel}".`,
        },
      }));

      try {
        const response = await runRelevantSegmentSearch(request, (message) => {
          setAiCodingRelevantSegmentsSessions((prev) => {
            const existing = prev[documentId];
            if (!existing) return prev;
            return {
              ...prev,
              [documentId]: {
                ...existing,
                searching: true,
                searchNotice: message,
              },
            };
          });
        });

        setAiCodingRelevantSegmentsSessions((prev) => ({
          ...prev,
          [documentId]: {
            searching: false,
            lockedCodeId: request.codeId,
            results: response.segments,
            lastModel: response.model,
            searchError: "",
            searchNotice:
              response.segments.length > 0
                ? `${response.model} reviewed ${response.searchedItems} indexed candidates and returned ${response.segments.length} relevant segments.`
                : `${response.model} reviewed ${response.searchedItems} indexed candidates but did not identify any strong matches yet.`,
          },
        }));
      } catch (error) {
        setAiCodingRelevantSegmentsSessions((prev) => ({
          ...prev,
          [documentId]: {
            searching: false,
            lockedCodeId: request.codeId,
            results: [],
            lastModel: "",
            searchError: describeUnknownError(error, "Could not search for relevant segments."),
            searchNotice: "",
          },
        }));
        throw error;
      }
    },
    [runRelevantSegmentSearch],
  );

  const clearAiCodingRelevantSegmentsSearch = useCallback((documentId: string) => {
    setAiCodingRelevantSegmentsSessions((prev) => {
      if (!prev[documentId]) return prev;
      const next = { ...prev };
      delete next[documentId];
      return next;
    });
  }, []);

  const runCodeConceptualSummaryLocally = useCallback(
    async (request: CodeAnalysisBaseAiJobRequest): Promise<CodeConceptualSummaryAiJobResult> => {
      const llmSettings = getHostLlmSettingsOrThrow();
      return invoke<CodeConceptualSummaryAiJobResult>("generate_code_conceptual_summary_with_ollama", {
        request: {
          ...request,
          ...buildLlmInvokeRequestFields(llmSettings),
        },
      });
    },
    [getHostLlmSettingsOrThrow],
  );

  const runCodeConceptualSummary = useCallback(
    async (request: CodeAnalysisBaseAiJobRequest, onProgress?: (message: string) => void): Promise<CodeConceptualSummaryAiJobResult> => {
      if (isLocalBackendUrl(pb.baseURL)) {
        return runCodeConceptualSummaryLocally(request);
      }
      onProgress?.("Queued for host AI processing...");
      const job = await createCodeConceptualSummaryAiJob(pb, request);
      const terminal = await waitForAiJobTerminalState(pb, job.id, {
        timeoutMs: 20 * 60 * 1000,
        onProgress: (currentJob) => onProgress?.(currentJob.hostMessage || "Waiting for host AI processing..."),
      });
      if (terminal.status === "error") throw new Error(terminal.errorMessage || "Host AI processing failed.");
      return JSON.parse(terminal.resultJson) as CodeConceptualSummaryAiJobResult;
    },
    [pb, runCodeConceptualSummaryLocally],
  );

  const runMostTypicalAnnotationLocally = useCallback(
    async (request: CodeAnalysisBaseAiJobRequest): Promise<MostTypicalAnnotationAiJobResult> => {
      const llmSettings = getHostLlmSettingsOrThrow();
      const result = await invoke<unknown>("generate_most_typical_annotation_with_ollama", {
        request: {
          ...request,
          ...buildLlmInvokeRequestFields(llmSettings),
        },
      });
      return normalizeMostTypicalAnnotationAiJobResult(result);
    },
    [getHostLlmSettingsOrThrow],
  );

  const runMostTypicalAnnotation = useCallback(
    async (request: CodeAnalysisBaseAiJobRequest, onProgress?: (message: string) => void): Promise<MostTypicalAnnotationAiJobResult> => {
      if (isLocalBackendUrl(pb.baseURL)) {
        return runMostTypicalAnnotationLocally(request);
      }
      onProgress?.("Queued for host AI processing...");
      const job = await createMostTypicalAnnotationAiJob(pb, request);
      const terminal = await waitForAiJobTerminalState(pb, job.id, {
        timeoutMs: 20 * 60 * 1000,
        onProgress: (currentJob) => onProgress?.(currentJob.hostMessage || "Waiting for host AI processing..."),
      });
      if (terminal.status === "error") throw new Error(terminal.errorMessage || "Host AI processing failed.");
      return normalizeMostTypicalAnnotationAiJobResult(JSON.parse(terminal.resultJson));
    },
    [pb, runMostTypicalAnnotationLocally],
  );

  const runCodeDecompositionLocally = useCallback(
    async (request: CodeAnalysisBaseAiJobRequest): Promise<CodeDecompositionAiJobResult> => {
      const llmSettings = getHostLlmSettingsOrThrow();
      return invoke<CodeDecompositionAiJobResult>("generate_code_decomposition_with_ollama", {
        request: {
          ...request,
          ...buildLlmInvokeRequestFields(llmSettings),
        },
      });
    },
    [getHostLlmSettingsOrThrow],
  );

  const runCodeDecomposition = useCallback(
    async (request: CodeAnalysisBaseAiJobRequest, onProgress?: (message: string) => void): Promise<CodeDecompositionAiJobResult> => {
      if (isLocalBackendUrl(pb.baseURL)) {
        return runCodeDecompositionLocally(request);
      }
      onProgress?.("Queued for host AI processing...");
      const job = await createCodeDecompositionAiJob(pb, request);
      const terminal = await waitForAiJobTerminalState(pb, job.id, {
        timeoutMs: 20 * 60 * 1000,
        onProgress: (currentJob) => onProgress?.(currentJob.hostMessage || "Waiting for host AI processing..."),
      });
      if (terminal.status === "error") throw new Error(terminal.errorMessage || "Host AI processing failed.");
      return JSON.parse(terminal.resultJson) as CodeDecompositionAiJobResult;
    },
    [pb, runCodeDecompositionLocally],
  );

  const runCodePositionLocally = useCallback(
    async (request: CodePositionAiJobRequest): Promise<CodePositionAiJobResult> => {
      const llmSettings = getHostLlmSettingsOrThrow();
      return invoke<CodePositionAiJobResult>("generate_code_position_with_ollama", {
        request: {
          ...request,
          ...buildLlmInvokeRequestFields(llmSettings),
        },
      });
    },
    [getHostLlmSettingsOrThrow],
  );

  const runCodePosition = useCallback(
    async (request: CodePositionAiJobRequest, onProgress?: (message: string) => void): Promise<CodePositionAiJobResult> => {
      if (isLocalBackendUrl(pb.baseURL)) {
        return runCodePositionLocally(request);
      }
      onProgress?.("Queued for host AI processing...");
      const job = await createCodePositionAiJob(pb, request);
      const terminal = await waitForAiJobTerminalState(pb, job.id, {
        timeoutMs: 20 * 60 * 1000,
        onProgress: (currentJob) => onProgress?.(currentJob.hostMessage || "Waiting for host AI processing..."),
      });
      if (terminal.status === "error") throw new Error(terminal.errorMessage || "Host AI processing failed.");
      return JSON.parse(terminal.resultJson) as CodePositionAiJobResult;
    },
    [pb, runCodePositionLocally],
  );

  const runCodeUniqueAnnotationsLocally = useCallback(
    async (request: CodeAnalysisBaseAiJobRequest): Promise<CodeUniqueAnnotationsAiJobResult> => {
      const llmSettings = getHostLlmSettingsOrThrow();
      const result = await invoke<unknown>("generate_code_unique_annotations_with_ollama", {
        request: {
          ...request,
          ...buildLlmInvokeRequestFields(llmSettings),
        },
      });
      return normalizeCodeUniqueAnnotationsAiJobResult(result);
    },
    [getHostLlmSettingsOrThrow],
  );

  const runCodeUniqueAnnotations = useCallback(
    async (request: CodeAnalysisBaseAiJobRequest, onProgress?: (message: string) => void): Promise<CodeUniqueAnnotationsAiJobResult> => {
      if (isLocalBackendUrl(pb.baseURL)) {
        return runCodeUniqueAnnotationsLocally(request);
      }
      onProgress?.("Queued for host AI processing...");
      const job = await createCodeUniqueAnnotationsAiJob(pb, request);
      const terminal = await waitForAiJobTerminalState(pb, job.id, {
        timeoutMs: 20 * 60 * 1000,
        onProgress: (currentJob) => onProgress?.(currentJob.hostMessage || "Waiting for host AI processing..."),
      });
      if (terminal.status === "error") throw new Error(terminal.errorMessage || "Host AI processing failed.");
      return normalizeCodeUniqueAnnotationsAiJobResult(JSON.parse(terminal.resultJson));
    },
    [pb, runCodeUniqueAnnotationsLocally],
  );

  async function loadPermissionContextForUser(projectId: string, userId: string) {
    const userRecord = await pb.collection("users").getOne(userId);
    const appRole = normalizeAppRole(userRecord.app_role);
    let projectRole: Role | null = null;
    if (appRole === "administrator") {
      projectRole = "owner";
    } else {
      try {
        const membership = await pb.collection("project_members").getFirstListItem(
          `project="${projectId}"&&user="${userId}"`,
        );
        projectRole = normalizeProjectRole(membership.role);
      } catch {
        projectRole = null;
      }
    }
    return { appRole, projectRole };
  }

  async function buildHostEmbeddingRequestForProject(projectId: string): Promise<EmbeddingBuildStartRequest> {
    const llmSettings = readAppSettings().llm;
    const [documentRecords, caseRecords, codeRecords, annotationRecords, memoRecords] = await Promise.all([
      pb.collection("documents").getFullList({ filter: `project="${projectId}"&&deleted_at=""`, sort: "created" }),
      pb.collection("cases").getFullList({ filter: `project="${projectId}"&&deleted_at=""`, sort: "created" }),
      pb.collection("codes").getFullList({ filter: `project="${projectId}"&&deleted_at=""`, sort: "created" }),
      pb.collection("annotations").getFullList({ filter: `deleted_at=""`, sort: "created" }),
      pb.collection("memos").getFullList({ filter: `project="${projectId}"&&deleted_at=""`, sort: "-created" }),
    ]);
    const documents = documentRecords.map(toDocument);
    const cases = caseRecords.map(toCase);
    const codes = codeRecords.map(toCode);
    const documentIds = new Set(documents.map((document) => document.id));
    const codeIds = new Set(codes.map((code) => code.id));
    const annotations = annotationRecords
      .map(toAnnotation)
      .filter((annotation) => documentIds.has(annotation.documentId) && codeIds.has(annotation.codeId));
    const memos = memoRecords.map(toMemo);
    const items = buildProjectEmbeddingItems(documents, cases, codes, annotations, memos, llmSettings);
    return {
      projectId,
      llmSettings: {
        batchSize: llmSettings.batchSize,
        chunkSize: llmSettings.chunkSize,
        overlapSize: llmSettings.overlapSize,
        prefixPassages: llmSettings.prefixPassages,
        normalizeWhitespace: llmSettings.normalizeWhitespace,
      },
      items,
    };
  }

  const processQueuedAiJobs = useCallback(async () => {
    if (!isLocalBackendUrl(pb.baseURL) || aiJobWorkerRunningRef.current || !pb.authStore.record?.id) return;
    aiJobWorkerRunningRef.current = true;
    try {
      const queuedJobs = await pb.collection(AI_JOB_COLLECTION).getFullList({
        filter: `status="queued"`,
        sort: "+created",
      });
      for (const queuedRecord of queuedJobs) {
        const currentRecord = await pb.collection(AI_JOB_COLLECTION).getOne(String((queuedRecord as { id?: unknown }).id ?? ""));
        const job = toAiJobRecord(currentRecord as unknown as Record<string, unknown>);
        if (job.status !== "queued") continue;
        if (!job.id || !job.projectId) continue;

        try {
          await syncHostAiAssistRuntimeStatusForProject(job.projectId);
          const aiSettings = await loadProjectAiAssistSettings(pb, job.projectId);
          if (!aiSettings.enabled) {
            await pb.collection(AI_JOB_COLLECTION).update(job.id, {
              status: "error",
              error_message: "AI Assist is disabled for this project.",
              host_message: "Host rejected this request because AI Assist is disabled for the project.",
            });
            continue;
          }
          const permissionContext = await loadPermissionContextForUser(job.projectId, job.createdBy);
          const requiredPermission: Permission =
            job.jobType === "document_processing"
              ? "useAiProcessDocuments"
              : job.jobType === "attribute_suggestions"
                ? "useAiAttributeTools"
                : job.jobType === "embedding_build"
                  ? "buildEmbeddings"
                : job.jobType === "relevant_segments_search"
                  ? "useAiCodingTools"
                  : job.jobType === "code_conceptual_summary"
                    || job.jobType === "most_typical_annotation"
                    || job.jobType === "code_decomposition"
                    || job.jobType === "code_position"
                    || job.jobType === "code_unique_annotations"
                    ? "useAiAnalyzeTools"
                    : "useAiChat";
          if (!hasPermission({ ...permissionContext, permission: requiredPermission })) {
            await pb.collection(AI_JOB_COLLECTION).update(job.id, {
              status: "error",
              error_message: "You do not have permission to run this AI request for the project.",
              host_message: "Host rejected this request because the requesting user lacks permission.",
            });
            continue;
          }

          await pb.collection(AI_JOB_COLLECTION).update(job.id, {
            status: "running",
            error_message: "",
            host_message:
              job.jobType === "document_processing"
                ? "Host AI is preparing document processing."
                : job.jobType === "attribute_suggestions"
                  ? "Host AI is preparing attribute suggestions."
                  : job.jobType === "embedding_build"
                    ? "Host AI is preparing a project embedding build."
                  : job.jobType === "relevant_segments_search"
                    ? "Host AI is searching for relevant project segments."
                    : job.jobType === "code_conceptual_summary"
                      || job.jobType === "most_typical_annotation"
                      || job.jobType === "code_decomposition"
                      || job.jobType === "code_position"
                      || job.jobType === "code_unique_annotations"
                      ? "Host AI is preparing analysis results."
                : "Host AI is preparing a response.",
          });

          if (job.jobType === "project_chat") {
            const request = JSON.parse(job.requestJson) as ProjectChatAiJobRequest;
            const result = await runProjectChatRequestLocally(request);
            await pb.collection(AI_JOB_COLLECTION).update(job.id, {
              status: "completed",
              result_json: JSON.stringify(result),
              host_message: "Host AI response is ready.",
            });
            continue;
          }

          if (job.jobType === "attribute_suggestions") {
            const request = JSON.parse(job.requestJson) as AttributeSuggestionAiJobRequest;
            const result = await runAttributeSuggestionsLocally(request);
            const latestRecord = await pb.collection(AI_JOB_COLLECTION).getOne(job.id);
            const latestJob = toAiJobRecord(latestRecord as unknown as Record<string, unknown>);
            if (
              latestJob.status === "error"
              && latestJob.errorMessage === "Attribute suggestion generation was stopped."
            ) {
              continue;
            }
            await pb.collection(AI_JOB_COLLECTION).update(job.id, {
              status: "completed",
              result_json: JSON.stringify(result),
              host_message: "Host AI attribute suggestions are ready.",
            });
            continue;
          }

          if (job.jobType === "embedding_build") {
            const request = JSON.parse(job.requestJson) as EmbeddingBuildAiJobRequest;
            const embeddingRequest = await buildHostEmbeddingRequestForProject(request.projectId);
            if (embeddingRequest.items.length === 0) {
              await pb.collection(AI_JOB_COLLECTION).update(job.id, {
                status: "error",
                error_message: "There is no project content available to embed yet.",
                host_message: "Host AI could not build embeddings because the project has no content to index.",
              });
              await syncHostAiAssistRuntimeStatusForProject(request.projectId);
              continue;
            }
            await pb.collection(AI_JOB_COLLECTION).update(job.id, {
              host_message: "Host AI is starting the project embedding build.",
            });
            await invoke<ProjectEmbeddingBuildStatus>("build_project_embedding_index_command", {
              authToken: pb.authStore.token,
              request: {
                projectId: embeddingRequest.projectId,
                batchSize: embeddingRequest.llmSettings.batchSize,
                chunkSize: embeddingRequest.llmSettings.chunkSize,
                overlapSize: embeddingRequest.llmSettings.overlapSize,
                prefixPassages: embeddingRequest.llmSettings.prefixPassages,
                normalizeWhitespace: embeddingRequest.llmSettings.normalizeWhitespace,
                items: embeddingRequest.items,
              },
            });

            for (;;) {
              const buildStatus = await invoke<ProjectEmbeddingBuildStatus>("get_project_embedding_build_status");
              await pb.collection(AI_JOB_COLLECTION).update(job.id, {
                status: buildStatus.phase === "error" || buildStatus.phase === "cancelled" ? "error" : "running",
                result_json: JSON.stringify({
                  completedItems: buildStatus.completedItems,
                  totalItems: buildStatus.totalItems,
                  progressPercent: buildStatus.progressPercent,
                }),
                host_message: buildStatus.message || "Host AI is building project embeddings.",
              });
              if (buildStatus.phase === "completed") {
                await pb.collection(AI_JOB_COLLECTION).update(job.id, {
                  status: "completed",
                  host_message: buildStatus.message || "Host AI Assist embeddings are ready for this project.",
                });
                await syncHostAiAssistRuntimeStatusForProject(request.projectId);
                break;
              }
              if (buildStatus.phase === "error" || buildStatus.phase === "cancelled") {
                await pb.collection(AI_JOB_COLLECTION).update(job.id, {
                  status: "error",
                  error_message: buildStatus.message || "Host embedding build failed.",
                  host_message: buildStatus.message || "Host embedding build failed.",
                });
                await syncHostAiAssistRuntimeStatusForProject(request.projectId);
                break;
              }
              await new Promise((resolve) => window.setTimeout(resolve, 700));
            }
            continue;
          }

          if (job.jobType === "relevant_segments_search") {
            const request = JSON.parse(job.requestJson) as RelevantSegmentsAiJobRequest;
            const result = await runRelevantSegmentSearchLocally(request);
            await pb.collection(AI_JOB_COLLECTION).update(job.id, {
              status: "completed",
              result_json: JSON.stringify(result),
              host_message: "Host AI relevant segment search is ready.",
            });
            continue;
          }

          if (job.jobType === "code_conceptual_summary") {
            const request = JSON.parse(job.requestJson) as CodeAnalysisBaseAiJobRequest;
            const result = await runCodeConceptualSummaryLocally(request);
            await pb.collection(AI_JOB_COLLECTION).update(job.id, {
              status: "completed",
              result_json: JSON.stringify(result),
              host_message: "Host AI conceptual summary is ready.",
            });
            continue;
          }

          if (job.jobType === "most_typical_annotation") {
            const request = JSON.parse(job.requestJson) as CodeAnalysisBaseAiJobRequest;
            const result = await runMostTypicalAnnotationLocally(request);
            await pb.collection(AI_JOB_COLLECTION).update(job.id, {
              status: "completed",
              result_json: JSON.stringify(result),
              host_message: "Host AI typical annotation analysis is ready.",
            });
            continue;
          }

          if (job.jobType === "code_decomposition") {
            const request = JSON.parse(job.requestJson) as CodeAnalysisBaseAiJobRequest;
            const result = await runCodeDecompositionLocally(request);
            await pb.collection(AI_JOB_COLLECTION).update(job.id, {
              status: "completed",
              result_json: JSON.stringify(result),
              host_message: "Host AI decomposition analysis is ready.",
            });
            continue;
          }

          if (job.jobType === "code_position") {
            const request = JSON.parse(job.requestJson) as CodePositionAiJobRequest;
            const result = await runCodePositionLocally(request);
            await pb.collection(AI_JOB_COLLECTION).update(job.id, {
              status: "completed",
              result_json: JSON.stringify(result),
              host_message: "Host AI code position analysis is ready.",
            });
            continue;
          }

          if (job.jobType === "code_unique_annotations") {
            const request = JSON.parse(job.requestJson) as CodeAnalysisBaseAiJobRequest;
            const result = await runCodeUniqueAnnotationsLocally(request);
            await pb.collection(AI_JOB_COLLECTION).update(job.id, {
              status: "completed",
              result_json: JSON.stringify(result),
              host_message: "Host AI unique annotation analysis is ready.",
            });
            continue;
          }

          const request = JSON.parse(job.requestJson) as DocumentProcessingAiJobRequest;
          const result = await processDocumentsWithHostRuntime(request, async (progress) => {
            await pb.collection(AI_JOB_COLLECTION).update(job.id, {
              status: "running",
              host_message: progress.message,
              result_json: JSON.stringify({
                completedDocuments: progress.completedDocuments,
                totalDocuments: progress.totalDocuments,
                currentDocumentName: progress.currentDocumentName,
                currentChunkIndex: progress.currentChunkIndex,
                currentChunkTotal: progress.currentChunkTotal,
                failures: progress.failures,
              }),
            });
          });
          await pb.collection(AI_JOB_COLLECTION).update(job.id, {
            status: "completed",
            result_json: JSON.stringify(result),
            host_message:
              result.failures.length > 0
                ? `Host AI processed ${result.processedDocuments} of ${result.totalDocuments} document(s).`
                : `Host AI processed ${result.totalDocuments} document(s).`,
          });
        } catch (error) {
          console.error("Failed to process queued AI job:", error);
          await pb.collection(AI_JOB_COLLECTION).update(job.id, {
            status: "error",
            error_message:
              error instanceof Error && error.message.trim()
                ? error.message
                : typeof error === "string" && error.trim()
                  ? error
                  : "Host AI processing failed.",
            host_message: "Host AI processing failed.",
          }).catch(() => {});
          void syncHostAiAssistRuntimeStatusForProject(job.projectId).catch(() => {});
        }
      }
    } finally {
      aiJobWorkerRunningRef.current = false;
    }
  }, [
    pb,
    processDocumentsWithHostRuntime,
    runAttributeSuggestionsLocally,
    runCodeConceptualSummaryLocally,
    runCodeDecompositionLocally,
    runCodePositionLocally,
    runCodeUniqueAnnotationsLocally,
    runMostTypicalAnnotationLocally,
    runProjectChatRequestLocally,
    runRelevantSegmentSearchLocally,
  ]);

  const syncProjectEmbeddingBuildStatus = useCallback(async () => {
    if (!isLocalBackendUrl(pb.baseURL)) {
      return projectEmbeddingBuildStatus ?? {
        phase: "idle",
        projectId: null,
        totalItems: 0,
        completedItems: 0,
        progressPercent: null,
        currentLabel: null,
        message: null,
      };
    }
    const status = await invoke<ProjectEmbeddingBuildStatus>("get_project_embedding_build_status");
    const previousPhase = projectEmbeddingLastPhaseRef.current;
    projectEmbeddingLastPhaseRef.current = status.phase;
    setProjectEmbeddingBuildStatus(status);

    if (status.phase === "running" || status.phase === "cancelling") {
      setProjectEmbeddingBuildBannerOpen(true);
      return status;
    }

    if (status.phase === "completed" && previousPhase !== "completed") {
      const pendingEnable = projectEmbeddingPendingEnableRef.current;
      if (pendingEnable && pendingEnable.projectId === status.projectId) {
        const nextSettings = await saveProjectAiAssistSettings(pb, pendingEnable.projectId, {
          ...pendingEnable.settings,
          enabled: true,
        });
        setProjectAiAssistSettings(nextSettings);
        projectEmbeddingPendingEnableRef.current = null;
      }
      const successLog = projectEmbeddingSuccessLogRef.current;
      if (successLog && successLog.projectId === status.projectId) {
        void logAction(successLog.projectId, successLog.action, successLog.label);
        projectEmbeddingSuccessLogRef.current = null;
      }
      setProjectEmbeddingBuildBannerOpen(true);
    } else if ((status.phase === "error" || status.phase === "cancelled") && previousPhase !== status.phase) {
      projectEmbeddingPendingEnableRef.current = null;
      projectEmbeddingSuccessLogRef.current = null;
      setProjectEmbeddingBuildBannerOpen(true);
    }

    return status;
  }, [logAction, pb, projectEmbeddingBuildStatus]);

  const startProjectEmbeddingBuild = useCallback(async (request: EmbeddingBuildStartRequest) => {
    projectEmbeddingPendingEnableRef.current = request.pendingAiAssistEnable ?? null;
    projectEmbeddingSuccessLogRef.current = request.successLog ?? null;
    setProjectEmbeddingBuildBannerOpen(true);
    if (!isLocalBackendUrl(pb.baseURL)) {
      if (projectEmbeddingRemoteJobRef.current) {
        throw new Error("A host embedding build is already in progress.");
      }
      const initialStatus: ProjectEmbeddingBuildStatus = {
        phase: "running",
        projectId: request.projectId,
        totalItems: 0,
        completedItems: 0,
        progressPercent: null,
        currentLabel: null,
        message: "Queued for host embedding build...",
      };
      projectEmbeddingLastPhaseRef.current = initialStatus.phase;
      setProjectEmbeddingBuildStatus(initialStatus);
      const job = await createEmbeddingBuildAiJob(pb, { projectId: request.projectId });
      const run = waitForAiJobTerminalState(pb, job.id, {
        timeoutMs: 60 * 60 * 1000,
        onProgress: (currentJob) => {
          setProjectEmbeddingBuildStatus((current) => ({
            phase: currentJob.status === "error" ? "error" : currentJob.status === "completed" ? "completed" : "running",
            projectId: request.projectId,
            totalItems: current?.totalItems ?? 0,
            completedItems: current?.completedItems ?? 0,
            progressPercent: current?.progressPercent ?? null,
            currentLabel: null,
            message: currentJob.hostMessage || "Waiting for host embedding build...",
          }));
        },
      })
        .then(async (terminal) => {
          if (terminal.status === "error") {
            const nextStatus: ProjectEmbeddingBuildStatus = {
              phase: "error",
              projectId: request.projectId,
              totalItems: 0,
              completedItems: 0,
              progressPercent: null,
              currentLabel: null,
              message: terminal.errorMessage || "Host embedding build failed.",
            };
            projectEmbeddingLastPhaseRef.current = nextStatus.phase;
            setProjectEmbeddingBuildStatus(nextStatus);
            setProjectEmbeddingBuildBannerOpen(true);
            return;
          }
          await syncProjectEmbeddingBuildStatus();
          const nextStatus: ProjectEmbeddingBuildStatus = {
            phase: "completed",
            projectId: request.projectId,
            totalItems: 0,
            completedItems: 0,
            progressPercent: 100,
            currentLabel: null,
            message: terminal.hostMessage || "Host AI Assist embeddings are ready for this project.",
          };
          projectEmbeddingLastPhaseRef.current = nextStatus.phase;
          setProjectEmbeddingBuildStatus(nextStatus);
          setProjectEmbeddingBuildBannerOpen(true);
          if (request.successLog) {
            await logAction(request.successLog.projectId, request.successLog.action, request.successLog.label);
          }
          if (request.pendingAiAssistEnable) {
            const nextSettings = await saveProjectAiAssistSettings(
              pb,
              request.pendingAiAssistEnable.projectId,
              request.pendingAiAssistEnable.settings,
            );
            setProjectAiAssistSettings(nextSettings);
          }
        })
        .finally(() => {
          projectEmbeddingRemoteJobRef.current = null;
        });
      projectEmbeddingRemoteJobRef.current = run;
      return initialStatus;
    }
    const status = await invoke<ProjectEmbeddingBuildStatus>("build_project_embedding_index_command", {
      authToken: pb.authStore.token,
      request: {
        projectId: request.projectId,
        batchSize: request.llmSettings.batchSize,
        chunkSize: request.llmSettings.chunkSize,
        overlapSize: request.llmSettings.overlapSize,
        prefixPassages: request.llmSettings.prefixPassages,
        normalizeWhitespace: request.llmSettings.normalizeWhitespace,
        items: request.items,
      },
    });
    projectEmbeddingLastPhaseRef.current = status.phase;
    setProjectEmbeddingBuildStatus(status);
    return status;
  }, [logAction, pb, syncProjectEmbeddingBuildStatus]);

  const cancelProjectEmbeddingBuild = useCallback(async () => {
    const status = await invoke<ProjectEmbeddingBuildStatus>("cancel_project_embedding_build", {
      authToken: pb.authStore.token,
    });
    projectEmbeddingLastPhaseRef.current = status.phase;
    setProjectEmbeddingBuildStatus(status);
    setProjectEmbeddingBuildBannerOpen(true);
    return status;
  }, [pb]);

  const dismissProjectEmbeddingBanner = useCallback(() => {
    setProjectEmbeddingBuildBannerOpen(false);
  }, []);

  const updateProjectAiAssistSettings = useCallback(
    async (projectId: string, settings: ProjectAiAssistSettings) => {
      const nextSettings = await saveProjectAiAssistSettings(pb, projectId, settings);
      setProjectAiAssistSettings(nextSettings);
      return nextSettings;
    },
    [pb],
  );

  const updateProjectDocumentImportSettings = useCallback(
    async (projectId: string, settings: ProjectDocumentImportSettings) => {
      const nextSettings = await saveProjectDocumentImportSettings(pb, projectId, settings);
      setProjectDocumentImportSettings(nextSettings);
      return nextSettings;
    },
    [pb],
  );

  const ensureProjectSafetyBackup = useCallback(
    async (sourceAction: string, sourceLabel: string) => {
      if (!activeProject || userRole !== "owner") return;
      await createProjectBackup(
        pb,
        activeProject,
        "automatic",
        logEntries[0]?.occurredAt ?? "",
        {
          action: sourceAction,
          label: sourceLabel,
          occurredAt: new Date().toISOString(),
        },
      );
    },
    [pb, activeProject, userRole, logEntries]
  );

  const startBackgroundDocumentProcessing = useCallback(
    async (request: DocumentProcessingRequest) => {
      if (documentProcessingJobRef.current) {
        throw new Error("Document processing is already running.");
      }

      setDocumentProcessingBannerOpen(true);
      setDocumentProcessingStatus({
        phase: "running",
        projectId: request.projectId,
        completedDocuments: 0,
        totalDocuments: request.documentIds.length,
        currentDocumentName: "",
        message: isLocalBackendUrl(pb.baseURL)
          ? `Preparing to ${request.restartDocumentIds?.length ? "restart" : "process"} ${request.documentIds.length} document${request.documentIds.length === 1 ? "" : "s"}.`
          : `Submitting ${request.documentIds.length} document${request.documentIds.length === 1 ? "" : "s"} to the host AI runtime${request.restartDocumentIds?.length ? " for restart" : ""}.`,
        failures: [],
      });

      const run = (async () => {
        try {
          if (isLocalBackendUrl(pb.baseURL)) {
            const result = await processDocumentsWithHostRuntime(request, async (progress) => {
              setDocumentProcessingStatus({
                phase: "running",
                projectId: request.projectId,
                completedDocuments: progress.completedDocuments,
                totalDocuments: progress.totalDocuments,
                currentDocumentName: progress.currentDocumentName,
                message: progress.message,
                failures: [...progress.failures],
                currentChunkIndex: progress.currentChunkIndex,
                currentChunkTotal: progress.currentChunkTotal,
              });
            });
            setDocumentProcessingStatus({
              phase: "completed",
              projectId: request.projectId,
              completedDocuments: result.totalDocuments,
              totalDocuments: result.totalDocuments,
              currentDocumentName: "",
              message:
                result.failures.length > 0
                  ? `Processed ${result.processedDocuments} of ${result.totalDocuments} document${result.totalDocuments === 1 ? "" : "s"} and added the successful ones to the review queue.`
                  : `Processed ${result.totalDocuments} document${result.totalDocuments === 1 ? "" : "s"} and added them to the review queue.`,
              failures: [...result.failures],
              currentChunkIndex: undefined,
              currentChunkTotal: undefined,
            });
          } else {
            const job = await createDocumentProcessingAiJob(pb, {
              projectId: request.projectId,
              documentIds: request.documentIds,
              reviewLenses: request.reviewLenses,
              restartDocumentIds: request.restartDocumentIds,
            });
            const terminal = await waitForAiJobTerminalState(pb, job.id, {
              timeoutMs: 60 * 60 * 1000,
              onProgress: (currentJob) => {
                let progressResult:
                  | {
                      completedDocuments?: number;
                      totalDocuments?: number;
                      currentDocumentName?: string;
                      currentChunkIndex?: number;
                      currentChunkTotal?: number;
                      failures?: Array<{ documentName: string; message: string }>;
                    }
                  | null = null;
                if (currentJob.resultJson) {
                  try {
                    progressResult = JSON.parse(currentJob.resultJson) as {
                      completedDocuments?: number;
                      totalDocuments?: number;
                      currentDocumentName?: string;
                      currentChunkIndex?: number;
                      currentChunkTotal?: number;
                      failures?: Array<{ documentName: string; message: string }>;
                    };
                  } catch {
                    progressResult = null;
                  }
                }
                setDocumentProcessingStatus({
                  phase: currentJob.status === "error" ? "error" : currentJob.status === "completed" ? "completed" : "running",
                  projectId: request.projectId,
                  completedDocuments: progressResult?.completedDocuments ?? 0,
                  totalDocuments: progressResult?.totalDocuments ?? request.documentIds.length,
                  currentDocumentName: progressResult?.currentDocumentName ?? "",
                  message: currentJob.hostMessage || "Waiting for host AI processing...",
                  failures: progressResult?.failures ?? [],
                  currentChunkIndex: progressResult?.currentChunkIndex,
                  currentChunkTotal: progressResult?.currentChunkTotal,
                  error: currentJob.status === "error" ? currentJob.errorMessage : undefined,
                });
              },
            });
            if (terminal.status === "error") {
              setDocumentProcessingStatus({
                phase: "error",
                projectId: request.projectId,
                completedDocuments: 0,
                totalDocuments: request.documentIds.length,
                currentDocumentName: "",
                message: terminal.errorMessage || "Host AI processing failed.",
                error: terminal.errorMessage || "Host AI processing failed.",
                failures: [],
                currentChunkIndex: undefined,
                currentChunkTotal: undefined,
              });
            } else {
              const result = terminal.resultJson
                ? JSON.parse(terminal.resultJson) as {
                    totalDocuments: number;
                    processedDocuments: number;
                    failures: Array<{ documentName: string; message: string }>;
                  }
                : { totalDocuments: request.documentIds.length, processedDocuments: request.documentIds.length, failures: [] };
              setDocumentProcessingStatus({
                phase: "completed",
                projectId: request.projectId,
                completedDocuments: result.totalDocuments,
                totalDocuments: result.totalDocuments,
                currentDocumentName: "",
                message:
                  result.failures.length > 0
                    ? `Host AI processed ${result.processedDocuments} of ${result.totalDocuments} document${result.totalDocuments === 1 ? "" : "s"} and added the successful ones to the review queue.`
                    : `Host AI processed ${result.totalDocuments} document${result.totalDocuments === 1 ? "" : "s"} and added them to the review queue.`,
                failures: [...result.failures],
                currentChunkIndex: undefined,
                currentChunkTotal: undefined,
              });
            }
          }
          setDocumentProcessingBannerOpen(true);
        } catch (error) {
          const message = error instanceof Error && error.message.trim()
            ? error.message
            : typeof error === "string" && error.trim()
              ? error
              : "Could not process the selected documents.";
          setDocumentProcessingStatus({
            phase: "error",
            projectId: request.projectId,
            completedDocuments: 0,
            totalDocuments: request.documentIds.length,
            currentDocumentName: "",
            message,
            error: message,
            failures: [],
            currentChunkIndex: undefined,
            currentChunkTotal: undefined,
          });
          setDocumentProcessingBannerOpen(true);
        } finally {
          documentProcessingJobRef.current = null;
        }
      })();

      documentProcessingJobRef.current = run;
    },
    [pb, processDocumentsWithHostRuntime],
  );

  const dismissDocumentProcessingBanner = useCallback(() => {
    setDocumentProcessingBannerOpen(false);
  }, []);

  const syncEmbeddingModelDownloadStatus = useCallback(async () => {
    const status = await invoke<EmbeddingModelDownloadStatus>("get_multilingual_e5_download_status");
    const previousPhase = embeddingModelDownloadLastPhaseRef.current;
    embeddingModelDownloadLastPhaseRef.current = status.phase;
    setEmbeddingModelDownloadStatus(status);

    if (status.phase === "downloading" || status.phase === "cancelling") {
      setEmbeddingModelDownloadBannerOpen(true);
      return status;
    }

    if (
      (status.phase === "completed" || status.phase === "cancelled" || status.phase === "error") &&
      previousPhase !== status.phase
    ) {
      setEmbeddingModelDownloadBannerOpen(true);
    }

    return status;
  }, []);

  const refreshEmbeddingModelDownloadPreflight = useCallback(async () => {
    const preflight = await invoke<EmbeddingModelDownloadPreflight>("get_multilingual_e5_download_preflight");
    setEmbeddingModelDownloadPreflight(preflight);
    return preflight;
  }, []);

  const startEmbeddingModelDownload = useCallback(async () => {
    if (embeddingModelDownloadJobRef.current) {
      throw new Error("The embedding model is already downloading.");
    }
    setEmbeddingModelDownloadBannerOpen(true);
    void refreshEmbeddingModelDownloadPreflight().catch(() => {});
    const nextStatus: EmbeddingModelDownloadStatus = {
      phase: "downloading",
      downloadedBytes: 0,
      totalBytes: null,
      downloadedFiles: 0,
      totalFiles: 0,
      currentFile: null,
      progressPercent: null,
      message: "Preparing download...",
    };
    embeddingModelDownloadLastPhaseRef.current = nextStatus.phase;
    setEmbeddingModelDownloadStatus(nextStatus);

    const run: Promise<void> = invoke("download_multilingual_e5_model", {
      authToken: pb.authStore.token,
    })
      .then(() => undefined)
      .catch(() => {})
      .finally(() => {
        embeddingModelDownloadJobRef.current = null;
        void syncEmbeddingModelDownloadStatus().catch(() => {});
        void refreshEmbeddingModelDownloadPreflight().catch(() => {});
      });

    embeddingModelDownloadJobRef.current = run;
  }, [pb, refreshEmbeddingModelDownloadPreflight, syncEmbeddingModelDownloadStatus]);

  const cancelEmbeddingModelDownload = useCallback(async () => {
    const status = await invoke<EmbeddingModelDownloadStatus>("cancel_multilingual_e5_download", {
      authToken: pb.authStore.token,
    });
    embeddingModelDownloadLastPhaseRef.current = status.phase;
    setEmbeddingModelDownloadStatus(status);
    setEmbeddingModelDownloadBannerOpen(true);
    return status;
  }, [pb]);

  const dismissEmbeddingModelDownloadBanner = useCallback(() => {
    setEmbeddingModelDownloadBannerOpen(false);
  }, []);

  async function syncHostAiAssistRuntimeStatusForProject(projectId: string) {
    if (!isLocalBackendUrl(pb.baseURL)) {
      return projectAiAssistRuntimeStatusRef.current;
    }

    const llmSettings = readAppSettings().llm;
    let hostLlmConnectionLive = false;
    const activeRuntime = hasConfiguredActiveLlm(llmSettings);

    if (activeRuntime) {
      if (llmSettings.connectionMode === "cloud") {
        hostLlmConnectionLive = true;
      } else {
        try {
          await invoke<number>("ping_address", {
            host: llmSettings.ollamaHost,
            port: llmSettings.ollamaPort,
          });
          hostLlmConnectionLive = true;
        } catch {
          hostLlmConnectionLive = false;
        }
      }
    }

    let hostEmbeddingModelInstalled = false;
    try {
      const embeddingStatus = await invoke<{ installed: boolean }>("get_multilingual_e5_status");
      hostEmbeddingModelInstalled = Boolean(embeddingStatus.installed);
    } catch {
      hostEmbeddingModelInstalled = false;
    }

    let hostProjectEmbeddingsReady = false;
    try {
      const indexStatus = await invoke<{ exists: boolean }>("get_project_embedding_index_status", { projectId });
      hostProjectEmbeddingsReady = Boolean(indexStatus.exists);
    } catch {
      hostProjectEmbeddingsReady = false;
    }

    const nextStatus: ProjectAiAssistRuntimeStatus = {
      hostEmbeddingModelInstalled,
      hostLlmEnabled: llmSettings.connectionMode !== "none",
      hostLlmModelSelected: hasSelectedActiveLlmModel(llmSettings),
      hostLlmConnectionLive,
      hostProjectEmbeddingsReady,
      hostCheckedAt: new Date().toISOString(),
    };

    setProjectAiAssistRuntimeStatus((current) => (
      sameProjectAiAssistRuntimeStatus(current, nextStatus)
        ? current
        : nextStatus
    ));

    if (sameProjectAiAssistRuntimeStatus(projectAiAssistRuntimeStatusRef.current, nextStatus)) {
      return nextStatus;
    }

    const saved = await saveProjectAiAssistRuntimeStatus(pb, projectId, nextStatus);
    setProjectAiAssistRuntimeStatus(saved);
    return saved;
  }

  useEffect(() => {
    void syncProjectEmbeddingBuildStatus().catch(() => {});
  }, [syncProjectEmbeddingBuildStatus]);

  useEffect(() => {
    void syncEmbeddingModelDownloadStatus().catch(() => {});
  }, [syncEmbeddingModelDownloadStatus]);

  useEffect(() => {
    void refreshEmbeddingModelDownloadPreflight().catch(() => {});
  }, [refreshEmbeddingModelDownloadPreflight]);

  useEffect(() => {
    const phase = projectEmbeddingBuildStatus?.phase;
    if (phase !== "running" && phase !== "cancelling") return;
    const interval = window.setInterval(() => {
      void syncProjectEmbeddingBuildStatus().catch(() => {});
    }, 700);
    return () => {
      window.clearInterval(interval);
    };
  }, [projectEmbeddingBuildStatus?.phase, syncProjectEmbeddingBuildStatus]);

  useEffect(() => {
    const phase = embeddingModelDownloadStatus?.phase;
    if (phase !== "downloading" && phase !== "cancelling") return;
    const interval = window.setInterval(() => {
      void syncEmbeddingModelDownloadStatus().catch(() => {});
    }, 700);
    return () => {
      window.clearInterval(interval);
    };
  }, [embeddingModelDownloadStatus?.phase, syncEmbeddingModelDownloadStatus]);

  const releaseDocumentLock = useCallback(
    async (lockId: string | null | undefined) => {
      if (!lockId) return;
      try {
        await pb.collection("document_locks").delete(lockId);
      } catch {
        // Best-effort cleanup only.
      }
    },
    [pb]
  );

  const kickDocumentLock = useCallback(
    async (lock: { id: string; documentId: string; documentName?: string; userId: string; userName: string }) => {
      const currentUserId = pb.authStore.record?.id;
      const currentUserName = pb.authStore.record?.name || pb.authStore.record?.email || "Project owner";
      if (!activeProject || !currentUserId) {
        throw new Error("A project must be open to clear a document lock.");
      }

      await pb.collection("document_lock_kicks").create({
        document: lock.documentId,
        user: lock.userId,
        kicked_by: currentUserId,
        kicked_by_name: currentUserName,
        expires_at_ms: Date.now() + DOCUMENT_LOCK_KICK_WINDOW_MS,
      });
      await releaseDocumentLock(lock.id);
      await logAction(
        activeProject.id,
        "document_lock.kick",
        `Removed ${lock.userName} from Code Text for "${lock.documentName || "document"}"`,
      );
    },
    [pb, activeProject, logAction, releaseDocumentLock]
  );

  const acquireDocumentLock = useCallback(
    async (document: Document): Promise<{ ok: true; lock: DocumentLockInfo } | { ok: false; conflict: DocumentLockInfo | null }> => {
      const currentUserId = pb.authStore.record?.id;
      const currentUserName = pb.authStore.record?.name || pb.authStore.record?.email || "Unknown user";
      if (!currentUserId) {
        return { ok: false, conflict: null };
      }

      const now = Date.now();
      const leaseExpiresAt = now + DOCUMENT_LOCK_LEASE_MS;
      const kickRecords = await pb.collection("document_lock_kicks").getFullList({
        filter: `document="${document.id}"&&user="${currentUserId}"`,
      });
      const expiredKicks = kickRecords.filter((record) => Number(record.expires_at_ms ?? 0) <= now);
      if (expiredKicks.length > 0) {
        await Promise.all(expiredKicks.map((record) =>
          pb.collection("document_lock_kicks").delete(record.id).catch(() => {})
        ));
      }
      const activeKick = kickRecords.find((record) => Number(record.expires_at_ms ?? 0) > now);
      if (activeKick) {
        return {
          ok: false,
          conflict: {
            id: activeKick.id,
            documentId: document.id,
            documentName: document.name,
            userId: String(activeKick.kicked_by ?? ""),
            userName: String(activeKick.kicked_by_name ?? "Project owner"),
            expiresAtMs: Number(activeKick.expires_at_ms ?? 0),
            reason: "kicked",
          },
        };
      }

      const records = await pb.collection("document_locks").getFullList({
        filter: `document="${document.id}"`,
      });

      const expired = records.filter((record) => Number(record.expires_at_ms ?? 0) <= now);
      if (expired.length > 0) {
        await Promise.all(expired.map((record) => releaseDocumentLock(record.id)));
      }

      const activeLocks = records.filter((record) => Number(record.expires_at_ms ?? 0) > now);
      const conflictingLock = activeLocks.find((record) => record.user !== currentUserId);
      if (conflictingLock) {
        return {
          ok: false,
          conflict: toDocumentLockInfo(conflictingLock, document.name),
        };
      }

      const ownLock = activeLocks.find((record) => record.user === currentUserId);
      if (ownLock) {
        const updated = await pb.collection("document_locks").update(ownLock.id, {
          user_name: currentUserName,
          expires_at_ms: leaseExpiresAt,
        });
        return { ok: true, lock: toDocumentLockInfo(updated, document.name) };
      }

      const created = await pb.collection("document_locks").create({
        document: document.id,
        user: currentUserId,
        user_name: currentUserName,
        expires_at_ms: leaseExpiresAt,
      });
      return { ok: true, lock: toDocumentLockInfo(created, document.name) };
    },
    [pb, releaseDocumentLock]
  );

  // ── Initial load ──────────────────────────────────────────────────────────

  useEffect(() => {
    const userId = pb.authStore.record?.id;
    if (!userId) return;
    setProjectsLoading(true);
    const projectSource = isAdministrator
      ? pb.collection("projects").getFullList({ sort: "-created" })
      : pb.collection("project_members")
          .getFullList({ filter: `user="${userId}"`, expand: "project", sort: "-created" })
          .then((memberships) => (
            memberships
              .map((m) => m.expand?.project)
              .filter(Boolean) as RecordModel[]
          ));
    projectSource
      .then(async (projectRecords) => {
        const ownerMap = await fetchOwnerMap(pb, projectRecords.map((r) => r.id));
        setProjects(projectRecords.map((r) => ({ ...toProject(r), createdBy: ownerMap[r.id] })));
      })
      .catch(console.error)
      .finally(() => setProjectsLoading(false));
  }, [pb, isAdministrator]);

  useEffect(() => {
    if (startupRestoreAttempted.current || projectsLoading || activeProject) return;
    startupRestoreAttempted.current = true;
    const settings = readAppSettings();
    if (!settings.startup.reopenLastProject) return;
    const lastProjectId = getLastProjectId();
    if (!lastProjectId) return;
    const project = projects.find((item) => item.id === lastProjectId);
    if (project) {
      void (async () => {
        const uid = pb.authStore.record?.id;
        const now = new Date().toISOString();
        try {
          const membership = await pb.collection("project_members")
            .getFirstListItem(`project="${project.id}" && user="${uid}"`);
          await pb.collection("project_members").update(membership.id, { last_active: now });
        } catch {
          // Startup restore should be best-effort only.
        }
        await logAction(project.id, "project.open", `Opened project "${project.name}"`);
        rememberRecentProject(project);
        rememberLastProjectId(project.id);
        setActiveProject(project);
        setActiveDocument(null);
        setPendingImportedUserResolution(null);
        setView("home");
      })();
    }
  }, [projects, projectsLoading, activeProject, pb, logAction]);

  // ── Real-time: projects + memberships ─────────────────────────────────────

  useEffect(() => {
    const userId = pb.authStore.record?.id;
    const unsubProjects = pb.collection("projects").subscribe("*", (e) => {
      if (e.action === "create" && isAdministrator) {
        const project = toProject(e.record);
        setProjects((p) => p.some((x) => x.id === project.id) ? p : [project, ...p]);
      }
      if (e.action === "update") {
        const project = toProject(e.record);
        setProjects((p) => p.map((x) => x.id === project.id ? { ...project, createdBy: x.createdBy } : x));
        setActiveProject((current) => current?.id === project.id ? project : current);
      }
      if (e.action === "delete") setProjects((p) => p.filter((x) => x.id !== e.record.id));
    });
    const unsubMembers = pb.collection("project_members").subscribe("*", async (e) => {
      if (isAdministrator) return;
      if (e.record.user !== userId) return;
      if (e.action === "create") {
        try {
          const proj = await pb.collection("projects").getOne(e.record.project);
          const ownerMap = await fetchOwnerMap(pb, [proj.id]);
          const project = { ...toProject(proj), createdBy: ownerMap[proj.id] };
          setProjects((p) => p.some((x) => x.id === proj.id) ? p : [project, ...p]);
        } catch { /* project deleted */ }
      }
      if (e.action === "delete") setProjects((p) => p.filter((x) => x.id !== e.record.project));
    });
    return () => {
      unsubProjects.then((fn) => fn()).catch(() => {});
      unsubMembers.then((fn) => fn()).catch(() => {});
    };
  }, [pb, isAdministrator]);

  // ── Load project data + real-time when active project changes ─────────────

  useEffect(() => {
    if (!activeProject) return;
    const pid = activeProject.id;
    const uid = pb.authStore.record?.id;
    setProjectAiAssistSettingsLoading(true);
    void loadProjectSettingsSnapshot(pb, pid, {
      documentImportSettings: {
        storeOriginalFileName: readAppSettings().documentImport.storeOriginalFileName,
      },
    })
      .then((snapshot) => {
        setProjectAiAssistSettings(snapshot.aiAssistSettings);
        setProjectAiAssistRuntimeStatus(snapshot.aiAssistRuntimeStatus);
        setProjectDocumentImportSettings(snapshot.documentImportSettings);
      })
      .catch((error) => {
        console.error("Failed to load shared project settings:", error);
        setProjectAiAssistSettings(DEFAULT_PROJECT_AI_ASSIST_SETTINGS);
        setProjectAiAssistRuntimeStatus(DEFAULT_PROJECT_AI_ASSIST_RUNTIME_STATUS);
        setProjectDocumentImportSettings(DEFAULT_PROJECT_DOCUMENT_IMPORT_SETTINGS);
      })
      .finally(() => setProjectAiAssistSettingsLoading(false));

    // Load user's role for this project
    if (isAdministrator) {
      setUserRole("owner");
    } else {
      pb.collection("project_members")
        .getFirstListItem(`project="${pid}" && user="${uid}"`)
        .then((r) => setUserRole(normalizeProjectRole(r.role)))
        .catch(() => setUserRole(null));
    }

    pb.collection("documents")
      .getFullList({ filter: `project="${pid}"&&deleted_at=""`, sort: "created" })
      .then((r) => setDocuments(r.map(toDocument)))
      .catch(console.error);

    pb.collection(PROJECT_UPLOADED_FILES_COLLECTION)
      .getFullList({ filter: `project="${pid}"&&deleted_at=""`, sort: "-created" })
      .then((r) => setProjectUploadedFiles(r.map((record) => ({
        ...toProjectUploadedFile(record),
        statusHistoryJson: JSON.stringify(toProjectUploadedFile(record).statusHistory),
      }))))
      .catch(console.error);

    pb.collection("cases")
      .getFullList({ filter: `project="${pid}"&&deleted_at=""`, sort: "created" })
      .then((r) => setCases(r.map(toCase)))
      .catch(console.error);

    pb.collection("codes")
      .getFullList({ filter: `project="${pid}"&&deleted_at=""`, sort: "created" })
      .then((r) => setCodes(r.map(toCode)))
      .catch(console.error);

    pb.collection("memos")
      .getFullList({ filter: `project="${pid}"&&deleted_at=""`, sort: "-created" })
      .then((r) => setMemos(r.map(toMemo)))
      .catch(console.error);

    pb.collection("project_log")
      .getFullList({ filter: `project="${pid}"`, sort: "-occurred_at" })
      .then((r) => setLogEntries(r.map(toLogEntry)))
      .catch(console.error);

    const unsubDocs = pb.collection("documents").subscribe("*", (e) => {
      if (e.record.project !== pid) return;
      if (e.action === "create") setDocuments((p) => [...p, toDocument(e.record)]);
      if (e.action === "update") {
        if (e.record.deleted_at) {
          setDocuments((p) => p.filter((x) => x.id !== e.record.id));
        } else {
          const d = toDocument(e.record);
          setDocuments((p) => p.some((x) => x.id === d.id) ? p.map((x) => x.id === d.id ? d : x) : [...p, d]);
          // Keep activeDocument in sync so processed content changes are reflected immediately
          setActiveDocument((current) => current?.id === d.id ? d : current);
        }
      }
      if (e.action === "delete") setDocuments((p) => p.filter((x) => x.id !== e.record.id));
    });

    const unsubUploadedFiles = pb.collection(PROJECT_UPLOADED_FILES_COLLECTION).subscribe("*", (e) => {
      if (e.record.project !== pid) return;
      const uploadedFile = {
        ...toProjectUploadedFile(e.record),
        statusHistoryJson: JSON.stringify(toProjectUploadedFile(e.record).statusHistory),
      };
      if (e.action === "create") {
        setProjectUploadedFiles((current) => [uploadedFile, ...current.filter((item) => item.id !== uploadedFile.id)]);
      }
      if (e.action === "update") {
        if (e.record.deleted_at) {
          setProjectUploadedFiles((current) => current.filter((item) => item.id !== e.record.id));
        } else {
          setProjectUploadedFiles((current) =>
            current.some((item) => item.id === uploadedFile.id)
              ? current.map((item) => item.id === uploadedFile.id ? uploadedFile : item)
              : [uploadedFile, ...current],
          );
        }
      }
      if (e.action === "delete") {
        setProjectUploadedFiles((current) => current.filter((item) => item.id !== e.record.id));
      }
    });

    const unsubCases = pb.collection("cases").subscribe("*", (e) => {
      if (e.record.project !== pid) return;
      if (e.action === "create") setCases((p) => [...p, toCase(e.record)]);
      if (e.action === "update") {
        if (e.record.deleted_at) {
          setCases((p) => p.filter((x) => x.id !== e.record.id));
        } else {
          const c = toCase(e.record);
          setCases((p) => p.some((x) => x.id === c.id) ? p.map((x) => x.id === c.id ? c : x) : [...p, c]);
        }
      }
      if (e.action === "delete") setCases((p) => p.filter((x) => x.id !== e.record.id));
    });

    const unsubCodes = pb.collection("codes").subscribe("*", (e) => {
      if (e.record.project !== pid) return;
      if (e.action === "create") setCodes((p) => [...p, toCode(e.record)]);
      if (e.action === "update") {
        if (e.record.deleted_at) {
          setCodes((p) => p.filter((x) => x.id !== e.record.id));
        } else {
          const c = toCode(e.record);
          setCodes((p) => p.some((x) => x.id === c.id) ? p.map((x) => x.id === c.id ? c : x) : [...p, c]);
        }
      }
      if (e.action === "delete") setCodes((p) => p.filter((x) => x.id !== e.record.id));
    });

    const unsubMemos = pb.collection("memos").subscribe("*", (e) => {
      if (e.record.project !== pid) return;
      if (e.action === "create") setMemos((p) => [toMemo(e.record), ...p]);
      if (e.action === "update") {
        if (e.record.deleted_at) {
          setMemos((p) => p.filter((x) => x.id !== e.record.id));
        } else {
          const m = toMemo(e.record);
          setMemos((p) => p.some((x) => x.id === m.id) ? p.map((x) => x.id === m.id ? m : x) : [m, ...p]);
        }
      }
      if (e.action === "delete") setMemos((p) => p.filter((x) => x.id !== e.record.id));
    });

    const unsubLog = pb.collection("project_log").subscribe("*", (e) => {
      if (e.record.project !== pid) return;
      const entry = toLogEntry(e.record);
      if (e.action === "create") {
        setLogEntries((p) => p.some((x) => x.id === entry.id) ? p : [entry, ...p]);
      }
      if (e.action === "update") {
        setLogEntries((p) => p.map((x) => x.id === entry.id ? entry : x));
      }
      if (e.action === "delete") {
        setLogEntries((p) => p.filter((x) => x.id !== entry.id));
      }
    });

    const unsubProjectSettings = pb.collection("project_settings").subscribe("*", (e) => {
      if (e.record.project !== pid) return;
      if (e.action === "delete") {
        void loadProjectSettingsSnapshot(pb, pid, {
          documentImportSettings: {
            storeOriginalFileName: readAppSettings().documentImport.storeOriginalFileName,
          },
        })
          .then((snapshot) => {
            setProjectAiAssistSettings(snapshot.aiAssistSettings);
            setProjectAiAssistRuntimeStatus(snapshot.aiAssistRuntimeStatus);
            setProjectDocumentImportSettings(snapshot.documentImportSettings);
          })
          .catch((error) => {
            console.error("Failed to reload shared project settings:", error);
            setProjectAiAssistSettings(DEFAULT_PROJECT_AI_ASSIST_SETTINGS);
            setProjectAiAssistRuntimeStatus(DEFAULT_PROJECT_AI_ASSIST_RUNTIME_STATUS);
            setProjectDocumentImportSettings(DEFAULT_PROJECT_DOCUMENT_IMPORT_SETTINGS);
          });
        return;
      }
      setProjectAiAssistSettings(projectAiAssistSettingsFromRecord(e.record));
      setProjectAiAssistRuntimeStatus(projectAiAssistRuntimeStatusFromRecord(e.record));
      setProjectDocumentImportSettings(projectDocumentImportSettingsFromRecord(e.record));
    });

      return () => {
        unsubDocs.then((fn) => fn()).catch(() => {});
        unsubUploadedFiles.then((fn) => fn()).catch(() => {});
        unsubCases.then((fn) => fn()).catch(() => {});
        unsubCodes.then((fn) => fn()).catch(() => {});
        unsubMemos.then((fn) => fn()).catch(() => {});
        unsubLog.then((fn) => fn()).catch(() => {});
        unsubProjectSettings.then((fn) => fn()).catch(() => {});
        setDocuments([]);
        setProjectUploadedFiles([]);
        setCases([]);
        setCodes([]);
        setMemos([]);
        setAnnotations([]);
        setLogEntries([]);
        setActiveDocument(null);
        setUserRole(null);
        setProjectAiAssistSettings(DEFAULT_PROJECT_AI_ASSIST_SETTINGS);
        setProjectAiAssistRuntimeStatus(DEFAULT_PROJECT_AI_ASSIST_RUNTIME_STATUS);
        setProjectAiAssistSettingsLoading(false);
        setProjectDocumentImportSettings(DEFAULT_PROJECT_DOCUMENT_IMPORT_SETTINGS);
      };
  }, [pb, activeProject, isAdministrator]);

  useEffect(() => {
    if (!activeProject || !isLocalBackendUrl(pb.baseURL)) {
      return;
    }
    const projectId = activeProject.id;

    let cancelled = false;
    let intervalId = 0;

    async function syncHostAiAssistRuntimeStatus() {
      if (cancelled) return;
      try {
        await syncHostAiAssistRuntimeStatusForProject(projectId);
      } catch (error) {
        console.error("Failed to sync host AI Assist runtime status:", error);
      }
    }

    void syncHostAiAssistRuntimeStatus();

    function refreshOnFocus() {
      void syncHostAiAssistRuntimeStatus();
    }

    intervalId = window.setInterval(() => {
      void syncHostAiAssistRuntimeStatus();
    }, 15000);
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [activeProject?.id, pb, projectEmbeddingBuildStatus?.phase]);

  useEffect(() => {
    if (!isLocalBackendUrl(pb.baseURL) || !pb.authStore.record?.id) {
      return;
    }

    void processQueuedAiJobs();
    const intervalId = window.setInterval(() => {
      void processQueuedAiJobs();
    }, 4000);

    const subscription = pb.collection(AI_JOB_COLLECTION).subscribe("*", (event) => {
      const status = String((event.record as { status?: unknown }).status ?? "");
      const jobType = String((event.record as { job_type?: unknown }).job_type ?? "");
      const errorMessage = String((event.record as { error_message?: unknown }).error_message ?? "");
      if (status === "queued") {
        void processQueuedAiJobs();
      }
      if (
        jobType === "attribute_suggestions"
        && status === "error"
        && errorMessage === "Attribute suggestion generation was stopped."
      ) {
        try {
          const rawRequest = (event.record as { request_json?: unknown }).request_json;
          const request = JSON.parse(
            typeof rawRequest === "string" ? rawRequest : JSON.stringify(rawRequest ?? {}),
          ) as AttributeSuggestionAiJobRequest;
          if (request.runId) {
            void invoke("cancel_attribute_suggestion_run", { runId: request.runId }).catch(() => {});
          }
        } catch {
          // Ignore malformed request payloads during best-effort cancellation.
        }
      }
    });

    return () => {
      window.clearInterval(intervalId);
      subscription.then((dispose) => dispose()).catch(() => {});
    };
  }, [pb, processQueuedAiJobs]);

  useEffect(() => {
    if (!activeDocument) {
      return;
    }
    const did = activeDocument.id;

    pb.collection("annotations")
      .getFullList({ filter: `document="${did}"&&deleted_at=""`, sort: "start_offset", expand: "created_by" })
      .then((r) => setAnnotations(r.map(toAnnotation)))
      .catch(console.error);

    const unsubAnnotations = pb.collection("annotations").subscribe("*", async (e) => {
      if (e.record.document !== did) return;
      if (e.action === "create" || (e.action === "update" && !e.record.deleted_at)) {
        const full = await pb.collection("annotations").getOne(e.record.id, { expand: "created_by" });
        if (e.action === "create") {
          setAnnotations((p) => [...p, toAnnotation(full)].sort((a, b) => a.startOffset - b.startOffset));
        } else {
          const ann = toAnnotation(full);
          setAnnotations((p) => p.some((x) => x.id === ann.id) ? p.map((x) => x.id === ann.id ? ann : x) : [...p, ann].sort((a, b) => a.startOffset - b.startOffset));
        }
      }
      if (e.action === "delete" || (e.action === "update" && e.record.deleted_at))
        setAnnotations((p) => p.filter((x) => x.id !== e.record.id));
    });

    return () => {
      unsubAnnotations.then((fn) => fn()).catch(() => {});
      setAnnotations([]);
    };
  }, [pb, activeDocument]);

  useEffect(() => {
    if (!DOCUMENT_LOCKING_VIEWS.includes(view) || !activeDocument || !activeProject || !pb.authStore.record?.id) {
      setDocumentLockConflict(null);
      if (activeDocumentLock) {
        void releaseDocumentLock(activeDocumentLock.id);
      }
      setActiveDocumentLock(null);
      return;
    }

    let cancelled = false;
    let heartbeatId: ReturnType<typeof setInterval> | null = null;
    let heldLockId: string | null = null;

    const syncLock = async () => {
      try {
        const result = await acquireDocumentLock(activeDocument);
        if (cancelled) return;
        if (result.ok) {
          heldLockId = result.lock.id;
          setActiveDocumentLock(result.lock);
          setDocumentLockConflict(null);
        } else {
          setActiveDocumentLock(null);
          setDocumentLockConflict(result.conflict);
        }
      } catch {
        if (!cancelled) {
          setActiveDocumentLock(null);
        }
      }
    };

    void syncLock();
    heartbeatId = setInterval(() => { void syncLock(); }, DOCUMENT_LOCK_HEARTBEAT_MS);

    return () => {
      cancelled = true;
      if (heartbeatId) clearInterval(heartbeatId);
      if (heldLockId) {
        void releaseDocumentLock(heldLockId);
      }
      setActiveDocumentLock(null);
    };
  }, [pb, view, activeDocument, activeProject, acquireDocumentLock, releaseDocumentLock]);

  // ── Projects ──────────────────────────────────────────────────────────────

  const createProject = useCallback(
    async (name: string, description: string) => {
      const identity = await getBackendIdentitySnapshot(pb);
      const record = await pb.collection("projects").create({
        name,
        description,
        backend_identifier: identity.backendIdentifier,
        users_table_identifier: identity.usersTableIdentifier,
      });
      const project = toProject(record);
      await pb.collection("project_members").create({
        project: project.id,
        user: pb.authStore.record?.id,
        user_identifier: pb.authStore.record?.user_identifier || "",
        role: "owner",
      });
      await saveProjectAiAssistSettings(pb, project.id, DEFAULT_PROJECT_AI_ASSIST_SETTINGS);
      await saveProjectDocumentImportSettings(pb, project.id, DEFAULT_PROJECT_DOCUMENT_IMPORT_SETTINGS);
      await logAction(project.id, "project.create", `Created project "${name}"`);
      return project;
    },
    [pb, logAction]
  );

  const updateProject = useCallback(
    async (id: string, data: { name: string; description: string }) => {
      const record = await pb.collection("projects").update(id, data);
      const project = toProject(record);
      setProjects((prev) => prev.map((p) => p.id === id ? { ...project, createdBy: p.createdBy } : p));
      setActiveProject((current) => current?.id === id ? project : current);
      await logAction(id, "project.update", `Updated project details for "${data.name}"`);
      return project;
    },
    [pb, logAction]
  );

  const openProjectToView = useCallback(async (
    project: Project,
    targetView: View,
    prevProject?: Project | null,
  ) => {
    const uid = pb.authStore.record?.id;
    const now = new Date().toISOString();

    // Log close of previous project (when switching)
    if (prevProject && prevProject.id !== project.id) {
      await logAction(prevProject.id, "project.close", `Left project "${prevProject.name}"`);
    }

    // Stamp last_active on the membership record
    try {
      const membership = await pb.collection("project_members")
        .getFirstListItem(`project="${project.id}" && user="${uid}"`);
      await pb.collection("project_members").update(membership.id, { last_active: now });
    } catch { /* membership may not exist yet */ }

    await logAction(project.id, "project.open", `Opened project "${project.name}"`);

    rememberRecentProject(project);
    rememberLastProjectId(project.id);
    setActiveProject(project);
    setActiveDocument(null);
    if (targetView !== "users") {
      setPendingImportedUserResolution(null);
    }
    setView(targetView);
  }, [pb, logAction]);

  const openProject = useCallback(async (project: Project, prevProject?: Project | null) => {
    await openProjectToView(project, "home", prevProject);
  }, [openProjectToView]);

  const closeProject = useCallback(async (project: Project) => {
    await logAction(project.id, "project.close", `Left project "${project.name}"`);
    clearLastProjectId();
    setActiveProject(null);
    setActiveDocument(null);
    setPendingImportedUserResolution(null);
    setView("projects");
  }, [logAction]);

  const deleteProject = useCallback(
    async (project: Project) => {
      const uid = pb.authStore.record?.id;
      if (!uid) throw new Error("You must be signed in to delete a project.");

      let membership: RecordModel | null = null;
      if (!isAdministrator) {
        membership = await pb.collection("project_members").getFirstListItem(
          `project="${project.id}" && user="${uid}"`
        );
      }
      if (!isAdministrator && normalizeProjectRole(membership?.role) !== "owner") {
        throw new Error("Only the project owner can delete this project.");
      }

      await createProjectBackup(
        pb,
        project,
        "automatic",
        "",
        {
          action: "project.delete",
          label: `Deleted project "${project.name}"`,
          occurredAt: new Date().toISOString(),
        },
      );

      const deleteAll = async (collection: string, filter: string) => {
        const records = await pb.collection(collection).getFullList({ filter });
        await Promise.all(records.map((record) => pb.collection(collection).delete(record.id)));
      };

      await Promise.all([
        deleteAll("annotations", `document.project="${project.id}"`),
        deleteAll("document_locks", `document.project="${project.id}"`),
        deleteAll("document_lock_kicks", `document.project="${project.id}"`),
        deleteAll("processed_document_reviews", `document.project="${project.id}"`),
        deleteAll("project_uploaded_files", `project="${project.id}"`),
        deleteAll("memos", `project="${project.id}"`),
        deleteAll("case_documents", `case.project="${project.id}"`),
        deleteAll("case_attributes", `case.project="${project.id}"`),
        deleteAll("case_attribute_values", `case.project="${project.id}"`),
        deleteAll("document_attribute_values", `document.project="${project.id}"`),
        deleteAll("project_log", `project="${project.id}"`),
        deleteAll("project_ai_chat_messages", `(project="${project.id}"||chat.project="${project.id}")`),
        deleteAll("project_ai_chats", `project="${project.id}"`),
        deleteAll("code_reports", `project="${project.id}"`),
        deleteAll("coder_reports", `project="${project.id}"`),
        deleteAll("ai_analyses", `project="${project.id}"`),
        deleteAll("ai_attribute_suggestion_runs", `project="${project.id}"`),
        deleteAll("ai_jobs", `project="${project.id}"`),
      ]);

      await Promise.all([
        deleteAll("project_members", `project="${project.id}"`),
        deleteAll("project_settings", `project="${project.id}"`),
        deleteAll("case_attribute_definitions", `project="${project.id}"`),
        deleteAll("document_attribute_definitions", `project="${project.id}"`),
        deleteAll("documents", `project="${project.id}"`),
        deleteAll("cases", `project="${project.id}"`),
        deleteAll("codes", `project="${project.id}"`),
      ]);

      await pb.collection("projects").delete(project.id);

      forgetRecentProject(project.id);
      if (getLastProjectId() === project.id) {
        clearLastProjectId();
      }
      if (activeProject?.id === project.id) {
        setActiveProject(null);
        setActiveDocument(null);
        setUserRole(null);
        setPendingImportedUserResolution(null);
        setView("projects");
      }
    },
    [pb, activeProject, isAdministrator]
  );

  // ── Documents ─────────────────────────────────────────────────────────────

  // ── Restore ───────────────────────────────────────────────────────────────

  const restoreRecord = useCallback(
    async (action: string, recordId: string, logEntryId?: string) => {
      const entity = action.split(".")[0];
      try {
        switch (entity) {
          case "document": {
            const rec = await pb.collection("documents").getOne(recordId);
            const ts = rec.deleted_at;
            await pb.collection("documents").update(recordId, { deleted_at: "" });
            const anns = await pb.collection("annotations").getFullList({ filter: `document="${recordId}"&&deleted_at="${ts}"` });
            await Promise.all(anns.map((a) => pb.collection("annotations").update(a.id, { deleted_at: "" })));
            break;
          }
          case "code": {
            const rec = await pb.collection("codes").getOne(recordId);
            const ts = rec.deleted_at;
            await pb.collection("codes").update(recordId, { deleted_at: "" });
            const anns = await pb.collection("annotations").getFullList({ filter: `code="${recordId}"&&deleted_at="${ts}"` });
            await Promise.all(anns.map((a) => pb.collection("annotations").update(a.id, { deleted_at: "" })));
            break;
          }
          case "annotation":
            await pb.collection("annotations").update(recordId, { deleted_at: "" });
            break;
          case "memo":
            await pb.collection("memos").update(recordId, { deleted_at: "" });
            break;
          case "case":
            await pb.collection("cases").update(recordId, { deleted_at: "" });
            break;
          case "code_report":
            await pb.collection("code_reports").update(recordId, { deleted_at: "" });
            break;
          case "coder_report":
            await pb.collection("coder_reports").update(recordId, { deleted_at: "" });
            break;
        }
        const restoredAt = new Date().toISOString();
        if (logEntryId) {
          const restoredLog = await pb.collection("project_log").update(logEntryId, { restored_at: restoredAt });
          setLogEntries((prev) => prev.map((entry) => entry.id === logEntryId ? toLogEntry(restoredLog) : entry));
        }
        if (activeProject) await logAction(activeProject.id, `${entity}.restore`, `Restored ${entity}`, recordId);
      } catch (e) {
        console.error("Restore failed:", e);
        throw e;
      }
    },
    [pb, activeProject, logAction]
  );

  const createProjectUploadedFileRecord = useCallback(
    async (
      file: File,
      sourceKind: ProjectUploadedFileSourceKind,
      importSummary?: Record<string, unknown>,
    ) => {
      if (!activeProject) return null;
      const actorUserId = pb.authStore.record?.id ?? null;
      const actorIdentifier = String(pb.authStore.record?.user_identifier ?? "");
      const statusHistory: ProjectUploadedFileStatusEvent[] = [
        buildUploadedFileStatusEvent({
          fromStatus: null,
          toStatus: "active",
          reason: "Uploaded source file retained.",
          actorUserId,
          actorIdentifier,
        }),
      ];
      const record = await pb.collection(PROJECT_UPLOADED_FILES_COLLECTION).create({
        project: activeProject.id,
        document: "",
        case: "",
        uploaded_file: file,
        original_file_name: file.name,
        mime_type: file.type || "application/octet-stream",
        size_bytes: file.size,
        source_kind: sourceKind,
        status: "active",
        status_history_json: JSON.stringify(statusHistory),
        content_hash: "",
        import_summary_json: importSummary ? JSON.stringify(importSummary) : "",
        created_by: actorUserId ?? "",
        created_by_identifier: actorIdentifier,
        deleted_at: "",
      });
      return toProjectUploadedFile(record);
    },
    [activeProject, pb],
  );

  const updateProjectUploadedFileStatus = useCallback(
    async (
      uploadedFileId: string,
      nextStatus: ProjectUploadedFileStatus,
      reason: string,
      options?: {
        documentId?: string | null;
        caseId?: string | null;
      },
    ) => {
      const record = await pb.collection(PROJECT_UPLOADED_FILES_COLLECTION).getOne(uploadedFileId);
      const current = toProjectUploadedFile(record);
      const actorUserId = pb.authStore.record?.id ?? null;
      const actorIdentifier = String(pb.authStore.record?.user_identifier ?? "");
      const nextHistory = [
        ...current.statusHistory,
        buildUploadedFileStatusEvent({
          fromStatus: current.status,
          toStatus: nextStatus,
          reason,
          actorUserId,
          actorIdentifier,
          documentId: options?.documentId ?? current.documentId,
          caseId: options?.caseId ?? current.caseId,
        }),
      ];
      await pb.collection(PROJECT_UPLOADED_FILES_COLLECTION).update(uploadedFileId, {
        document: options?.documentId ?? current.documentId ?? "",
        case: options?.caseId ?? current.caseId ?? "",
        status: nextStatus,
        status_history_json: JSON.stringify(nextHistory),
      });
    },
    [pb],
  );

  const deleteProjectUploadedFile = useCallback(
    async (uploadedFileId: string, fileName?: string) => {
      const record = await pb.collection(PROJECT_UPLOADED_FILES_COLLECTION).getOne(uploadedFileId);
      const current = toProjectUploadedFile(record);
      const actorUserId = pb.authStore.record?.id ?? null;
      const actorIdentifier = String(pb.authStore.record?.user_identifier ?? "");
      const deletedAt = new Date().toISOString();
      const nextHistory = [
        ...current.statusHistory,
        buildUploadedFileStatusEvent({
          fromStatus: current.status,
          toStatus: "deleted",
          reason: `Retained source file${fileName ? ` "${fileName}"` : ""} was explicitly deleted from Project Settings.`,
          actorUserId,
          actorIdentifier,
          documentId: current.documentId,
          caseId: current.caseId,
        }),
      ];
      await pb.collection(PROJECT_UPLOADED_FILES_COLLECTION).update(uploadedFileId, {
        status: "deleted",
        status_history_json: JSON.stringify(nextHistory),
        deleted_at: deletedAt,
      });
      if (activeProject) {
        await logAction(
          activeProject.id,
          "project_uploaded_file.delete",
          `Deleted retained source file${fileName ? ` "${fileName}"` : ""}`,
          uploadedFileId,
        );
      }
    },
    [activeProject, logAction, pb],
  );

  const addDocument = useCallback(
    async (
      name: string,
      filePath: string,
      content: string,
      createdBy?: string,
      options?: {
        notes?: string;
        type?: string;
        setActive?: boolean;
        sourceFile?: File | null;
        sourceKind?: ProjectUploadedFileSourceKind;
        importSummary?: Record<string, unknown>;
      },
    ) => {
      if (!activeProject) return;
      const uploadedFileRecord = options?.sourceFile
        ? await createProjectUploadedFileRecord(
          options.sourceFile,
          options.sourceKind ?? "document",
          options.importSummary,
        )
        : null;
      const payload: Record<string, unknown> = {
        project: activeProject.id,
        name,
        type: options?.type ?? "Text",
        file_path: filePath,
        content,
        notes: options?.notes ?? "",
      };
        if (createdBy) payload.created_by = createdBy;
        payload.created_by_identifier = createdBy
          ? createdBy === pb.authStore.record?.id
            ? pb.authStore.record?.user_identifier || ""
            : ""
          : pb.authStore.record?.user_identifier || "";
        const record = await pb.collection("documents").create(payload);
      if (uploadedFileRecord?.id) {
        await updateProjectUploadedFileStatus(
          uploadedFileRecord.id,
          "processed",
          `Created document "${name}" from retained upload.`,
          { documentId: record.id },
        );
      }
      const doc = toDocument(record);
      if (options?.setActive !== false) {
        setActiveDocument(doc);
      }
      await logAction(activeProject.id, "document.create", `Added document "${name}"`);
      return doc;
    },
    [pb, activeProject, createProjectUploadedFileRecord, logAction, updateProjectUploadedFileStatus]
  );


      // Create new segments sequentially — avoids overwhelming PocketBase with
  const updateDocument = useCallback(
    async (id: string, data: { name?: string; notes?: string; content?: string }) => {
      await pb.collection("documents").update(id, data);

      if (activeProject && data.name) await logAction(activeProject.id, "document.update", `Renamed document to "${data.name}"`);
      else if (activeProject) await logAction(activeProject.id, "document.update", "Updated document");
    },
    [pb, activeProject, logAction]
  );

  const deleteDocument = useCallback(
    async (id: string, name?: string) => {
      await ensureProjectSafetyBackup("document.delete", `Deleted document${name ? ` "${name}"` : ""}`);
      const deletedAt = new Date().toISOString();
      // Cascade soft-delete to annotations so they don't surface in reports
      const anns = await pb.collection("annotations").getFullList({ filter: `document="${id}"&&deleted_at=""`, fields: "id" });
      await Promise.all(anns.map((a) => pb.collection("annotations").update(a.id, { deleted_at: deletedAt })));
      await pb.collection("documents").update(id, { deleted_at: deletedAt });
      const uploadedFiles = await pb.collection(PROJECT_UPLOADED_FILES_COLLECTION).getFullList({
        filter: `document="${id}"&&deleted_at=""&&status!="deleted"`,
      });
      await Promise.all(
        uploadedFiles.map((record) =>
          updateProjectUploadedFileStatus(
            record.id,
            "orphaned",
            `Document${name ? ` "${name}"` : ""} was deleted while retaining the original upload.`,
            { documentId: id },
          ),
        ),
      );
      if (activeProject) await logAction(activeProject.id, "document.delete", `Deleted document${name ? ` "${name}"` : ""}`, id);
    },
    [pb, activeProject, logAction, ensureProjectSafetyBackup, updateProjectUploadedFileStatus]
  );

  const addCaseDocument = useCallback(
    async (caseId: string, documentId: string) => {
      await pb.collection("case_documents").create({ case: caseId, document: documentId });
    },
    [pb, isAdministrator]
  );

  const removeCaseDocument = useCallback(
    async (recordId: string) => {
      await pb.collection("case_documents").delete(recordId);
    },
    [pb]
  );

  // ── Codes ─────────────────────────────────────────────────────────────────

  const addCode = useCallback(
    async (label: string, color: string, description: string, shortcut?: string, parentId?: string, createdBy?: string) => {
      if (!activeProject) return;
      const record = await pb.collection("codes").create({
        project: activeProject.id,
        label,
        color,
          description,
          shortcut: shortcut ?? "",
          parent: parentId || null,
          created_by: createdBy || pb.authStore.record?.id || null,
          created_by_identifier: createdBy
            ? createdBy === pb.authStore.record?.id
              ? pb.authStore.record?.user_identifier || ""
              : ""
            : pb.authStore.record?.user_identifier || "",
        });
      await logAction(activeProject.id, "code.create", `Added code "${label}"`);
      return toCode(record);
    },
    [pb, activeProject, logAction]
  );

  const updateCode = useCallback(
    async (id: string, data: { label: string; color: string; description: string; parentId?: string }) => {
      await pb.collection("codes").update(id, {
        label: data.label,
        color: data.color,
        description: data.description,
        parent: data.parentId || null,
      });
      if (activeProject) await logAction(activeProject.id, "code.update", `Updated code "${data.label}"`);
    },
    [pb, activeProject, logAction]
  );

  const deleteCode = useCallback(
    async (id: string, label?: string) => {
      await ensureProjectSafetyBackup("code.delete", `Deleted code${label ? ` "${label}"` : ""}`);
      const deletedAt = new Date().toISOString();
      const anns = await pb.collection("annotations").getFullList({ filter: `code="${id}"&&deleted_at=""`, fields: "id" });
      await Promise.all(anns.map((a) => pb.collection("annotations").update(a.id, { deleted_at: deletedAt })));
      await pb.collection("codes").update(id, { deleted_at: deletedAt });
      if (activeProject) await logAction(activeProject.id, "code.delete", `Deleted code${label ? ` "${label}"` : ""}`, id);
    },
    [pb, activeProject, logAction, ensureProjectSafetyBackup]
  );

  // ── Annotations ───────────────────────────────────────────────────────────

  const ensureCurrentUserDocumentLock = useCallback(
    async (documentId: string): Promise<DocumentLockInfo> => {
      const currentUserId = pb.authStore.record?.id;
      if (!currentUserId) {
        throw new Error("You must be signed in to annotate.");
      }

      const localLock = activeDocumentLockRef.current;
      if (
        localLock &&
        localLock.documentId === documentId &&
        localLock.userId === currentUserId &&
        localLock.expiresAtMs > Date.now()
      ) {
        return localLock;
      }

      const targetDocument =
        activeDocument?.id === documentId
          ? activeDocument
          : documents.find((doc) => doc.id === documentId) ?? null;

      if (!targetDocument) {
        throw new Error("This document is no longer available.");
      }

      const result = await acquireDocumentLock(targetDocument);
      if (!result.ok) {
        setActiveDocumentLock(null);
        setDocumentLockConflict(result.conflict);
        throw new Error("This document is locked for annotation by another user.");
      }

      setActiveDocumentLock(result.lock);
      setDocumentLockConflict(null);
      return result.lock;
    },
    [pb, activeDocument, documents, acquireDocumentLock]
  );

  const addAnnotation = useCallback(
    async (documentId: string, codeId: string, startOffset: number, endOffset: number, quote: string, note = "") => {
      await ensureCurrentUserDocumentLock(documentId);
      const targetDocument =
        activeDocument?.id === documentId
          ? activeDocument
          : documents.find((doc) => doc.id === documentId) ?? null;
      const contentLength = targetDocument?.content.length ?? 0;
      const normalizedStart = Math.max(0, Math.min(startOffset, endOffset));
      const normalizedEnd = Math.min(contentLength, Math.max(startOffset, endOffset));
      const normalizedQuote =
        targetDocument?.content.slice(normalizedStart, normalizedEnd)
        || quote
        || "";

      if (!Number.isFinite(normalizedStart) || !Number.isFinite(normalizedEnd) || normalizedEnd <= normalizedStart) {
        throw new Error("The selected text range is invalid. Please try selecting the text again.");
      }

      const record = await pb.collection("annotations").create({
        document: documentId,
        code: codeId,
        start_offset: String(normalizedStart),
        end_offset: String(normalizedEnd),
        quote: normalizedQuote,
        note,
        created_by: pb.authStore.record?.id,
        created_by_identifier: pb.authStore.record?.user_identifier || "",
      });
      const truncated = normalizedQuote.length > 40 ? normalizedQuote.slice(0, 40) + "…" : normalizedQuote;
      if (activeProject) await logAction(activeProject.id, "annotation.create", `Annotated "${truncated}"`);
      return toAnnotation(record);
    },
    [pb, activeProject, logAction, ensureCurrentUserDocumentLock, activeDocument, documents]
  );

  const updateAnnotationNote = useCallback(
    async (id: string, note: string) => {
      await pb.collection("annotations").update(id, { note });
      if (activeProject) await logAction(activeProject.id, "annotation.update", "Updated annotation note");
    },
    [pb, activeProject, logAction]
  );

  const deleteAnnotation = useCallback(
    async (id: string) => {
      await ensureProjectSafetyBackup("annotation.delete", "Deleted annotation");
      await pb.collection("annotations").update(id, { deleted_at: new Date().toISOString() });
      if (activeProject) await logAction(activeProject.id, "annotation.delete", "Deleted annotation", id);
    },
    [pb, activeProject, logAction, ensureProjectSafetyBackup]
  );

  // ── Cases ─────────────────────────────────────────────────────────────────

  const createCase = useCallback(
    async (name: string, createdBy?: string, notes = "") => {
      if (!activeProject) return;
        const record = await pb.collection("cases").create({
          project: activeProject.id,
          name,
          notes,
          created_by: createdBy || pb.authStore.record?.id || "",
          created_by_identifier: createdBy
            ? createdBy === pb.authStore.record?.id
              ? pb.authStore.record?.user_identifier || ""
              : ""
            : pb.authStore.record?.user_identifier || "",
        });
      await logAction(activeProject.id, "case.create", `Created case "${name}"`);
      return record;
    },
    [pb, activeProject, logAction]
  );

  const updateCase = useCallback(
    async (id: string, data: { name: string; notes: string }) => {
      await pb.collection("cases").update(id, data);
      if (activeProject) await logAction(activeProject.id, "case.update", `Updated case "${data.name}"`);
    },
    [pb, activeProject, logAction]
  );

  const deleteCase = useCallback(
    async (id: string, name?: string) => {
      await ensureProjectSafetyBackup("case.delete", `Deleted case${name ? ` "${name}"` : ""}`);
      await pb.collection("cases").update(id, { deleted_at: new Date().toISOString() });
      if (activeProject) await logAction(activeProject.id, "case.delete", `Deleted case${name ? ` "${name}"` : ""}`, id);
    },
    [pb, activeProject, logAction, ensureProjectSafetyBackup]
  );

  // ── Memos ─────────────────────────────────────────────────────────────────

  const addMemo = useCallback(
    async (data: {
      title: string;
      body: string;
      documentIds?: string[];
      annotationIds?: string[];
      caseIds?: string[];
      codeIds?: string[];
      caseAttributeDefIds?: string[];
      documentAttributeDefIds?: string[];
      createdBy?: string;
    }) => {
      if (!activeProject) return;
        const record = await pb.collection("memos").create({
          project: activeProject.id,
          title: data.title,
          body: data.body,
          document: data.documentIds ?? [],
          annotation: data.annotationIds ?? [],
          cases: data.caseIds ?? [],
          codes: data.codeIds ?? [],
          case_attribute_defs: data.caseAttributeDefIds ?? [],
          document_attribute_defs: data.documentAttributeDefIds ?? [],
          created_by: data.createdBy || pb.authStore.record?.id,
          created_by_identifier: data.createdBy
            ? data.createdBy === pb.authStore.record?.id
              ? pb.authStore.record?.user_identifier || ""
              : ""
            : pb.authStore.record?.user_identifier || "",
        });
      await logAction(activeProject.id, "memo.create", `Created memo "${data.title}"`);
      return toMemo(record);
    },
    [pb, activeProject, logAction]
  );

  const updateMemo = useCallback(
    async (id: string, data: {
      title: string;
      body: string;
      documentIds?: string[];
      annotationIds?: string[];
      caseIds?: string[];
      codeIds?: string[];
      caseAttributeDefIds?: string[];
      documentAttributeDefIds?: string[];
    }) => {
      await pb.collection("memos").update(id, {
        title: data.title,
        body: data.body,
        document: data.documentIds ?? [],
        annotation: data.annotationIds ?? [],
        cases: data.caseIds ?? [],
        codes: data.codeIds ?? [],
        case_attribute_defs: data.caseAttributeDefIds ?? [],
        document_attribute_defs: data.documentAttributeDefIds ?? [],
      });
      if (activeProject) await logAction(activeProject.id, "memo.update", `Updated memo "${data.title}"`);
    },
    [pb, activeProject, logAction]
  );

  const deleteMemo = useCallback(
    async (id: string, title?: string) => {
      await ensureProjectSafetyBackup("memo.delete", `Deleted memo${title ? ` "${title}"` : ""}`);
      await pb.collection("memos").update(id, { deleted_at: new Date().toISOString() });
      if (activeProject) await logAction(activeProject.id, "memo.delete", `Deleted memo${title ? ` "${title}"` : ""}`, id);
    },
    [pb, activeProject, logAction, ensureProjectSafetyBackup]
  );

  // ── Code Reports ──────────────────────────────────────────────────────────

  const createCodeReport = useCallback(
    async (data: { name: string; caseIds: string[]; documentIds: string[]; codeIds: string[]; createdBy?: string; snapshot?: string }) => {
      if (!activeProject) return;
      const payload: Record<string, unknown> = {
        project: activeProject.id,
        name: data.name,
      };
        if (data.caseIds.length > 0) payload.cases = data.caseIds;
        if (data.documentIds.length > 0) payload.documents = data.documentIds;
        if (data.codeIds.length > 0) payload.codes = data.codeIds;
        const createdBy = data.createdBy || pb.authStore.record?.id;
        if (createdBy) payload.created_by = createdBy;
        payload.created_by_identifier = createdBy === pb.authStore.record?.id
          ? pb.authStore.record?.user_identifier || ""
          : "";
        if (data.snapshot) payload.snapshot = data.snapshot;

      let record;
      try {
        record = await pb.collection("code_reports").create(payload);
      } catch (error) {
        if (!isSnapshotTooLongError(error)) throw error;
        await ensureSetup(pb);
        record = await pb.collection("code_reports").create(payload);
      }
      await logAction(activeProject.id, "code_report.create", `Created report "${data.name}"`);
      return record;
    },
    [pb, activeProject, logAction]
  );

  const updateCodeReport = useCallback(
    async (id: string, data: { name: string; caseIds: string[]; documentIds: string[]; codeIds: string[] }) => {
      await pb.collection("code_reports").update(id, {
        name: data.name,
        cases: data.caseIds,
        documents: data.documentIds,
        codes: data.codeIds,
      });
      if (activeProject) await logAction(activeProject.id, "code_report.update", `Updated report "${data.name}"`);
    },
    [pb, activeProject, logAction]
  );

  const deleteCodeReport = useCallback(
    async (id: string, name?: string) => {
      await ensureProjectSafetyBackup("code_report.delete", `Deleted report${name ? ` "${name}"` : ""}`);
      await pb.collection("code_reports").update(id, { deleted_at: new Date().toISOString() });
      if (activeProject) await logAction(activeProject.id, "code_report.delete", `Deleted report${name ? ` "${name}"` : ""}`, id);
    },
    [pb, activeProject, logAction, ensureProjectSafetyBackup]
  );

  // ── Coder Reports ─────────────────────────────────────────────────────────

  const createCoderReport = useCallback(
    async (data: { name: string; coderIds: string[]; caseIds: string[]; documentIds: string[]; codeIds: string[]; createdBy?: string; snapshot?: string }) => {
      if (!activeProject) return;
      const payload: Record<string, unknown> = {
        project: activeProject.id,
        name: data.name,
      };
      if (data.coderIds.length > 0) payload.coders = data.coderIds;
      if (data.caseIds.length > 0) payload.cases = data.caseIds;
        if (data.documentIds.length > 0) payload.documents = data.documentIds;
        if (data.codeIds.length > 0) payload.codes = data.codeIds;
        const createdBy = data.createdBy || pb.authStore.record?.id;
        if (createdBy) payload.created_by = createdBy;
        payload.created_by_identifier = createdBy === pb.authStore.record?.id
          ? pb.authStore.record?.user_identifier || ""
          : "";
        payload.coder_identifiers = JSON.stringify(
          data.coderIds.map((coderId) =>
            coderId === pb.authStore.record?.id ? pb.authStore.record?.user_identifier || "" : "",
          ).filter(Boolean),
        );
        if (data.snapshot) payload.snapshot = data.snapshot;

      let record;
      try {
        record = await pb.collection("coder_reports").create(payload);
      } catch (error) {
        if (!isSnapshotTooLongError(error)) throw error;
        await ensureSetup(pb);
        record = await pb.collection("coder_reports").create(payload);
      }
      await logAction(activeProject.id, "coder_report.create", `Created coder report "${data.name}"`);
      return record;
    },
    [pb, activeProject, logAction]
  );

  const updateCoderReport = useCallback(
    async (id: string, data: { name: string; coderIds: string[]; caseIds: string[]; documentIds: string[]; codeIds: string[] }) => {
      await pb.collection("coder_reports").update(id, {
        name: data.name,
        coders: data.coderIds,
        cases: data.caseIds,
        documents: data.documentIds,
        codes: data.codeIds,
      });
      if (activeProject) await logAction(activeProject.id, "coder_report.update", `Updated coder report "${data.name}"`);
    },
    [pb, activeProject, logAction]
  );

  const deleteCoderReport = useCallback(
    async (id: string, name?: string) => {
      await ensureProjectSafetyBackup("coder_report.delete", `Deleted coder report${name ? ` "${name}"` : ""}`);
      await pb.collection("coder_reports").update(id, { deleted_at: new Date().toISOString() });
      if (activeProject) await logAction(activeProject.id, "coder_report.delete", `Deleted coder report${name ? ` "${name}"` : ""}`, id);
    },
    [pb, activeProject, logAction, ensureProjectSafetyBackup]
  );

  const createAiAnalysis = useCallback(
    async (data: { name: string; codeId?: string | null; createdBy?: string; snapshot?: string }) => {
      if (!activeProject) return;
      const payload: Record<string, unknown> = {
        project: activeProject.id,
        name: data.name,
      };
      if (data.codeId) payload.code = data.codeId;
      const createdBy = data.createdBy || pb.authStore.record?.id;
      if (createdBy) payload.created_by = createdBy;
      payload.created_by_identifier = createdBy === pb.authStore.record?.id
        ? pb.authStore.record?.user_identifier || ""
        : "";
      if (data.snapshot) payload.snapshot = data.snapshot;

      let record;
      try {
        record = await pb.collection("ai_analyses").create(payload);
      } catch (error) {
        if (!isSnapshotTooLongError(error)) throw error;
        await ensureSetup(pb);
        record = await pb.collection("ai_analyses").create(payload);
      }
      await logAction(activeProject.id, "ai_analysis.create", `Created analysis "${data.name}"`);
      return record;
    },
    [pb, activeProject, logAction]
  );

  const updateAiAnalysis = useCallback(
    async (id: string, data: { name: string; codeId?: string | null; snapshot?: string }) => {
      const payload: Record<string, unknown> = {
        name: data.name,
        code: data.codeId || null,
      };
      if (typeof data.snapshot === "string") payload.snapshot = data.snapshot;
      try {
        await pb.collection("ai_analyses").update(id, payload);
      } catch (error) {
        if (!isSnapshotTooLongError(error)) throw error;
        await ensureSetup(pb);
        await pb.collection("ai_analyses").update(id, payload);
      }
      if (activeProject) await logAction(activeProject.id, "ai_analysis.update", `Updated analysis "${data.name}"`, id);
    },
    [pb, activeProject, logAction]
  );

  const deleteAiAnalysis = useCallback(
    async (id: string, name?: string) => {
      await ensureProjectSafetyBackup("ai_analysis.delete", `Deleted analysis${name ? ` "${name}"` : ""}`);
      await pb.collection("ai_analyses").update(id, { deleted_at: new Date().toISOString() });
      if (activeProject) await logAction(activeProject.id, "ai_analysis.delete", `Deleted analysis${name ? ` "${name}"` : ""}`, id);
    },
    [pb, activeProject, logAction, ensureProjectSafetyBackup]
  );

  const createAiAttributeSuggestionRun = useCallback(
    async (data: { name: string; targetKind: "case" | "document"; attributeId?: string | null; attributeName?: string; createdBy?: string; snapshot?: string }) => {
      if (!activeProject) return;
      const payload: Record<string, unknown> = {
        project: activeProject.id,
        name: data.name,
        target_kind: data.targetKind,
        attribute_id: data.attributeId || "",
        attribute_name: data.attributeName || "",
      };
      const createdBy = data.createdBy || pb.authStore.record?.id;
      if (createdBy) payload.created_by = createdBy;
      payload.created_by_identifier = createdBy === pb.authStore.record?.id
        ? pb.authStore.record?.user_identifier || ""
        : "";
      if (data.snapshot) payload.snapshot = data.snapshot;

      let record;
      try {
        record = await pb.collection("ai_attribute_suggestion_runs").create(payload);
      } catch (error) {
        if (!isSnapshotTooLongError(error)) throw error;
        await ensureSetup(pb);
        record = await pb.collection("ai_attribute_suggestion_runs").create(payload);
      }
      await logAction(activeProject.id, "ai_attribute_suggestion_run.create", `Created saved suggestions "${data.name}"`);
      return record;
    },
    [pb, activeProject, logAction]
  );

  const updateAiAttributeSuggestionRun = useCallback(
    async (id: string, data: { name: string; targetKind: "case" | "document"; attributeId?: string | null; attributeName?: string; snapshot?: string }) => {
      const payload: Record<string, unknown> = {
        name: data.name,
        target_kind: data.targetKind,
        attribute_id: data.attributeId || "",
        attribute_name: data.attributeName || "",
      };
      if (typeof data.snapshot === "string") payload.snapshot = data.snapshot;
      try {
        await pb.collection("ai_attribute_suggestion_runs").update(id, payload);
      } catch (error) {
        if (!isSnapshotTooLongError(error)) throw error;
        await ensureSetup(pb);
        await pb.collection("ai_attribute_suggestion_runs").update(id, payload);
      }
      if (activeProject) await logAction(activeProject.id, "ai_attribute_suggestion_run.update", `Updated saved suggestions "${data.name}"`, id);
    },
    [pb, activeProject, logAction]
  );

  const deleteAiAttributeSuggestionRun = useCallback(
    async (id: string, name?: string) => {
      await ensureProjectSafetyBackup("ai_attribute_suggestion_run.delete", `Deleted saved suggestions${name ? ` "${name}"` : ""}`);
      await pb.collection("ai_attribute_suggestion_runs").update(id, { deleted_at: new Date().toISOString() });
      if (activeProject) await logAction(activeProject.id, "ai_attribute_suggestion_run.delete", `Deleted saved suggestions${name ? ` "${name}"` : ""}`, id);
    },
    [pb, activeProject, logAction, ensureProjectSafetyBackup]
  );

  const setNetworkMode = useCallback(async (mode: "local" | "lan") => {
    const previousMode = networkMode;
    await invoke("set_network_mode", { authToken: pb.authStore.token, mode });
    setNetworkModeState(mode);
    if (activeProject && previousMode !== mode) {
      await logAction(
        activeProject.id,
        "project.network_mode.update",
        mode === "lan"
          ? "Enabled LAN collaboration mode for this session"
          : "Returned app network mode to local-only for this session",
      );
    }
  }, [activeProject, logAction, networkMode, pb]);

  useEffect(() => {
    setAiCodingRelevantSegmentsSessions({});
  }, [activeProject?.id]);

  return {
    pb,
    isLocalWorkspace: isLocalBackendUrl(pb.baseURL),
    view, setView,
    projects, projectsLoading,
    activeProject,
    userRole,
    appRole,
    isAdministrator,
    projectPermissions,
    appPermissions,
    canCurrentUser,
    documents,
    projectUploadedFiles,
    cases,
    activeDocument, setActiveDocument,
    codes,
    annotations,
    allAnnotations: annotations,
    activeDocumentLock,
    documentLockConflict,
    clearDocumentLockConflict: () => setDocumentLockConflict(null),
    kickDocumentLock,
    memos,
    logEntries,
    createProject, updateProject, deleteProject, openProject, openProjectToView, closeProject,
    restoreRecord,
    createProjectUploadedFileRecord,
    updateProjectUploadedFileStatus,
    deleteProjectUploadedFile,
    addDocument, updateDocument, deleteDocument,
    addCaseDocument, removeCaseDocument,
    addCode, updateCode, deleteCode,
    addAnnotation, updateAnnotationNote, deleteAnnotation,
    createCase, updateCase, deleteCase,
    addMemo, updateMemo, deleteMemo,
    createCodeReport, updateCodeReport, deleteCodeReport,
    createCoderReport, updateCoderReport, deleteCoderReport,
    createAiAnalysis, updateAiAnalysis, deleteAiAnalysis,
    createAiAttributeSuggestionRun, updateAiAttributeSuggestionRun, deleteAiAttributeSuggestionRun,
    cancelAttributeSuggestionRun,
    networkMode, setNetworkMode,
    projectEmbeddingBuildStatus,
    projectEmbeddingBuildBannerOpen,
    projectAiAssistSettings,
    projectAiAssistRuntimeStatus,
    projectAiAssistSettingsLoading,
    projectDocumentImportSettings,
    updateProjectAiAssistSettings,
    updateProjectDocumentImportSettings,
    runProjectChat,
    runAttributeSuggestions,
    runRelevantSegmentSearch,
    aiCodingRelevantSegmentsSessions,
    startAiCodingRelevantSegmentsSearch,
    clearAiCodingRelevantSegmentsSearch,
    runCodeConceptualSummary,
    runMostTypicalAnnotation,
    runCodeDecomposition,
    runCodePosition,
    runCodeUniqueAnnotations,
    startProjectEmbeddingBuild,
    cancelProjectEmbeddingBuild,
    dismissProjectEmbeddingBanner,
    documentProcessingStatus,
    documentProcessingBannerOpen,
    startBackgroundDocumentProcessing,
    dismissDocumentProcessingBanner,
    embeddingModelDownloadStatus,
    embeddingModelDownloadPreflight,
    embeddingModelDownloadBannerOpen,
    startEmbeddingModelDownload,
    cancelEmbeddingModelDownload,
    dismissEmbeddingModelDownloadBanner,
    logAction,
    ensureProjectSafetyBackup,
    pendingDocId, setPendingDocId,
    pendingAnnId, setPendingAnnId,
    pendingCodeId, setPendingCodeId,
    pendingTextCitation, setPendingTextCitation,
    pendingMemoId, setPendingMemoId,
    pendingNewMemoContext, setPendingNewMemoContext,
    pendingCaseId, setPendingCaseId,
    pendingImportedUserResolution, setPendingImportedUserResolution,
  };
}

export type AppStore = ReturnType<typeof useAppStore>;
