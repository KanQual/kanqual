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
  getAppRolePermissions,
  getProjectRolePermissions,
  hasPermission,
  normalizeAppRole,
  normalizeProjectRole,
  type Permission,
} from "../lib/permissions";
import { ensureSetup, getBackendIdentitySnapshot } from "../lib/pb";
import { createProjectBackup } from "../lib/projectBackups";
import type {
  ProjectEmbeddingBuildItem,
  ProjectEmbeddingBuildStatus,
} from "../lib/projectEmbeddings";
import {
  saveProjectAiAssistSettings,
  type ProjectAiAssistSettings,
} from "../lib/projectAiAssistSettings";

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
  const [pendingMemoId, setPendingMemoId] = useState<string | null>(null);
  const [pendingCaseId, setPendingCaseId] = useState<string | null>(null);
  const [pendingImportedUserResolution, setPendingImportedUserResolution] =
    useState<PendingImportedUserResolution | null>(null);
  const [logEntries,    setLogEntries]    = useState<ProjectLogEntry[]>([]);
  const [networkMode,   setNetworkModeState] = useState<"local" | "lan">("local");
  const [projectEmbeddingBuildStatus, setProjectEmbeddingBuildStatus] =
    useState<ProjectEmbeddingBuildStatus | null>(null);
  const [projectEmbeddingBuildBannerOpen, setProjectEmbeddingBuildBannerOpen] = useState(false);
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

  const syncProjectEmbeddingBuildStatus = useCallback(async () => {
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
        saveProjectAiAssistSettings(pendingEnable.projectId, {
          ...pendingEnable.settings,
          enabled: true,
        });
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
  }, [logAction]);

  const startProjectEmbeddingBuild = useCallback(async (request: EmbeddingBuildStartRequest) => {
    projectEmbeddingPendingEnableRef.current = request.pendingAiAssistEnable ?? null;
    projectEmbeddingSuccessLogRef.current = request.successLog ?? null;
    setProjectEmbeddingBuildBannerOpen(true);
    const status = await invoke<ProjectEmbeddingBuildStatus>("build_project_embedding_index_command", {
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
  }, []);

  const cancelProjectEmbeddingBuild = useCallback(async () => {
    const status = await invoke<ProjectEmbeddingBuildStatus>("cancel_project_embedding_build");
    projectEmbeddingLastPhaseRef.current = status.phase;
    setProjectEmbeddingBuildStatus(status);
    setProjectEmbeddingBuildBannerOpen(true);
    return status;
  }, []);

  const dismissProjectEmbeddingBanner = useCallback(() => {
    setProjectEmbeddingBuildBannerOpen(false);
  }, []);

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

      const llmSettings = readAppSettings().llm;
      if (!llmSettings.ollamaEnabled || !llmSettings.ollamaSelectedModel) {
        throw new Error("AI Assist settings are incomplete. Enable the local LLM and select a model in App Settings.");
      }

      const selectedDocuments = documents.filter((document) => request.documentIds.includes(document.id));
      if (selectedDocuments.length === 0) {
        throw new Error("Select at least one document to process.");
      }

      setDocumentProcessingBannerOpen(true);
      setDocumentProcessingStatus({
        phase: "running",
        projectId: request.projectId,
        completedDocuments: 0,
        totalDocuments: selectedDocuments.length,
        currentDocumentName: selectedDocuments[0]?.name || "Untitled document",
        message: `Preparing to process ${selectedDocuments.length} document${selectedDocuments.length === 1 ? "" : "s"}.`,
        failures: [],
      });

      const run = (async () => {
        let failedDocumentName = "";
        try {
          const interDocumentCooldownMs = 10_000;
          const failures: Array<{ documentName: string; message: string }> = [];
          for (let index = 0; index < selectedDocuments.length; index += 1) {
            const document = selectedDocuments[index];
            failedDocumentName = document.name || "Untitled document";
            setDocumentProcessingStatus({
              phase: "running",
              projectId: request.projectId,
              completedDocuments: index,
              totalDocuments: selectedDocuments.length,
              currentDocumentName: failedDocumentName,
              message: `Processing ${failedDocumentName} (${index + 1} of ${selectedDocuments.length}).`,
              failures: [...failures],
            });

            try {
              const response = await invoke<{
                processedContent: string;
                segments: unknown[];
                properNameCandidates: unknown[];
                model: string;
                baseUrl: string;
                chunkCount: number;
              }>("process_document_with_ollama", {
                request: {
                  documentContent: document.content,
                  protocol: llmSettings.ollamaProtocol,
                  host: llmSettings.ollamaHost,
                  port: llmSettings.ollamaPort,
                  model: llmSettings.ollamaSelectedModel,
                  timeoutSeconds: llmSettings.ollamaRequestTimeoutSeconds,
                  temperature: llmSettings.ollamaTemperature,
                  numCtx: llmSettings.ollamaNumCtx,
                  keepAliveMinutes: llmSettings.ollamaKeepAliveMinutes,
                },
              });

              const payload = {
                project: request.projectId,
                document: document.id,
                document_name: document.name,
                file_path: document.filePath,
                status: "pending_review",
                model: response.model,
                base_url: response.baseUrl,
                chunk_count: response.chunkCount,
                processed_content: response.processedContent,
                segments_json: JSON.stringify(response.segments),
                proper_name_candidates_json: JSON.stringify(response.properNameCandidates),
                enabled_review_lenses_json: JSON.stringify(request.reviewLenses),
                exported_to_project: false,
                created_by: pb.authStore.record?.id ?? "",
                created_by_identifier: String(pb.authStore.record?.user_identifier ?? ""),
                deleted_at: "",
              };

              try {
                const existing = await pb.collection("processed_document_reviews").getFirstListItem(
                  `project="${request.projectId}"&&document="${document.id}"&&deleted_at=""`,
                );
                await pb.collection("processed_document_reviews").update(existing.id, payload);
              } catch {
                await pb.collection("processed_document_reviews").create(payload);
              }

              setDocumentProcessingStatus({
                phase: "running",
                projectId: request.projectId,
                completedDocuments: index + 1,
                totalDocuments: selectedDocuments.length,
                currentDocumentName: document.name || "Untitled document",
                message: `Processed ${index + 1} of ${selectedDocuments.length} document${selectedDocuments.length === 1 ? "" : "s"}.`,
                failures: [...failures],
              });
            } catch (error) {
              const documentMessage = error instanceof Error && error.message.trim()
                ? error.message
                : typeof error === "string" && error.trim()
                  ? error
                  : "Could not process this document.";
              failures.push({
                documentName: failedDocumentName,
                message: documentMessage,
              });
              const remainingDocuments = selectedDocuments.length - (index + 1);
              setDocumentProcessingStatus({
                phase: "running",
                projectId: request.projectId,
                completedDocuments: index + 1,
                totalDocuments: selectedDocuments.length,
                currentDocumentName: failedDocumentName,
                message: remainingDocuments > 0
                  ? `Skipped ${failedDocumentName} after an error. Continuing with the remaining documents.`
                  : `Skipped ${failedDocumentName} after an error.`,
                failures: [...failures],
              });
            }

            if (index < selectedDocuments.length - 1) {
              const nextDocument = selectedDocuments[index + 1];
              setDocumentProcessingStatus({
                phase: "running",
                projectId: request.projectId,
                completedDocuments: index + 1,
                totalDocuments: selectedDocuments.length,
                currentDocumentName: nextDocument.name || "Untitled document",
                message: `Cooling down for 10 seconds before processing ${nextDocument.name || "the next document"} (${index + 2} of ${selectedDocuments.length}).`,
                failures: [...failures],
              });
              await new Promise((resolve) => window.setTimeout(resolve, interDocumentCooldownMs));
            }
          }

          setDocumentProcessingStatus({
            phase: "completed",
            projectId: request.projectId,
            completedDocuments: selectedDocuments.length,
            totalDocuments: selectedDocuments.length,
            currentDocumentName: "",
            message:
              failures.length > 0
                ? `Processed ${selectedDocuments.length - failures.length} of ${selectedDocuments.length} document${selectedDocuments.length === 1 ? "" : "s"} and added the successful ones to the review queue.`
                : `Processed ${selectedDocuments.length} document${selectedDocuments.length === 1 ? "" : "s"} and added them to the review queue.`,
            failures: [...failures],
          });
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
            totalDocuments: selectedDocuments.length,
            currentDocumentName: failedDocumentName,
            message: failedDocumentName
              ? `${message} Document: ${failedDocumentName}.`
              : message,
            error: message,
            failures: [],
          });
          setDocumentProcessingBannerOpen(true);
        } finally {
          documentProcessingJobRef.current = null;
        }
      })();

      documentProcessingJobRef.current = run;
    },
    [documents, pb],
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

    const run: Promise<void> = invoke("download_multilingual_e5_model")
      .then(() => undefined)
      .catch(() => {})
      .finally(() => {
        embeddingModelDownloadJobRef.current = null;
        void syncEmbeddingModelDownloadStatus().catch(() => {});
        void refreshEmbeddingModelDownloadPreflight().catch(() => {});
      });

    embeddingModelDownloadJobRef.current = run;
  }, [refreshEmbeddingModelDownloadPreflight, syncEmbeddingModelDownloadStatus]);

  const cancelEmbeddingModelDownload = useCallback(async () => {
    const status = await invoke<EmbeddingModelDownloadStatus>("cancel_multilingual_e5_download");
    embeddingModelDownloadLastPhaseRef.current = status.phase;
    setEmbeddingModelDownloadStatus(status);
    setEmbeddingModelDownloadBannerOpen(true);
    return status;
  }, []);

  const dismissEmbeddingModelDownloadBanner = useCallback(() => {
    setEmbeddingModelDownloadBannerOpen(false);
  }, []);

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

      return () => {
        unsubDocs.then((fn) => fn()).catch(() => {});
        unsubCases.then((fn) => fn()).catch(() => {});
        unsubCodes.then((fn) => fn()).catch(() => {});
        unsubMemos.then((fn) => fn()).catch(() => {});
        unsubLog.then((fn) => fn()).catch(() => {});
        setDocuments([]);
        setCases([]);
        setCodes([]);
        setMemos([]);
        setAnnotations([]);
      setLogEntries([]);
      setActiveDocument(null);
      setUserRole(null);
    };
  }, [pb, activeProject, isAdministrator]);

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
        deleteAll("memos", `project="${project.id}"`),
        deleteAll("case_documents", `case.project="${project.id}"`),
        deleteAll("case_attributes", `case.project="${project.id}"`),
        deleteAll("case_attribute_values", `case.project="${project.id}"`),
        deleteAll("document_attribute_values", `document.project="${project.id}"`),
        deleteAll("project_log", `project="${project.id}"`),
        deleteAll("code_reports", `project="${project.id}"`),
        deleteAll("coder_reports", `project="${project.id}"`),
      ]);

      await Promise.all([
        deleteAll("project_members", `project="${project.id}"`),
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
      },
    ) => {
      if (!activeProject) return;
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
      const doc = toDocument(record);
      if (options?.setActive !== false) {
        setActiveDocument(doc);
      }
      await logAction(activeProject.id, "document.create", `Added document "${name}"`);
      return doc;
    },
    [pb, activeProject, logAction]
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
      if (activeProject) await logAction(activeProject.id, "document.delete", `Deleted document${name ? ` "${name}"` : ""}`, id);
    },
    [pb, activeProject, logAction, ensureProjectSafetyBackup]
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

  const setNetworkMode = useCallback(async (mode: "local" | "lan") => {
    await invoke("set_network_mode", { mode });
    setNetworkModeState(mode);
  }, []);

  return {
    pb,
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
    addDocument, updateDocument, deleteDocument,
    addCaseDocument, removeCaseDocument,
    addCode, updateCode, deleteCode,
    addAnnotation, updateAnnotationNote, deleteAnnotation,
    createCase, updateCase, deleteCase,
    addMemo, updateMemo, deleteMemo,
    createCodeReport, updateCodeReport, deleteCodeReport,
    createCoderReport, updateCoderReport, deleteCoderReport,
    networkMode, setNetworkMode,
    projectEmbeddingBuildStatus,
    projectEmbeddingBuildBannerOpen,
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
    pendingCaseId, setPendingCaseId,
    pendingImportedUserResolution, setPendingImportedUserResolution,
  };
}

export type AppStore = ReturnType<typeof useAppStore>;
