import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";

export type ProjectAiAssistSettings = {
  enabled: boolean;
  allowSemanticSearch: boolean;
  allowQuestionAnswering: boolean;
  allowSummaries: boolean;
  allowCodeSuggestions: boolean;
  allowDraftReports: boolean;
};

export type ProjectAiAssistRuntimeStatus = {
  hostEmbeddingModelInstalled: boolean | null;
  hostLlmEnabled: boolean | null;
  hostLlmModelSelected: boolean | null;
  hostLlmConnectionLive: boolean | null;
  hostProjectEmbeddingsReady: boolean | null;
  hostCheckedAt: string;
};

export const DEFAULT_PROJECT_AI_ASSIST_SETTINGS: ProjectAiAssistSettings = {
  enabled: false,
  allowSemanticSearch: true,
  allowQuestionAnswering: true,
  allowSummaries: true,
  allowCodeSuggestions: false,
  allowDraftReports: false,
};

export const DEFAULT_PROJECT_AI_ASSIST_RUNTIME_STATUS: ProjectAiAssistRuntimeStatus = {
  hostEmbeddingModelInstalled: null,
  hostLlmEnabled: null,
  hostLlmModelSelected: null,
  hostLlmConnectionLive: null,
  hostProjectEmbeddingsReady: null,
  hostCheckedAt: "",
};

export type BackupRetentionSettings = {
  hourlyHours: number;
  dailyDays: number;
  weeklyWeeks: number;
};

export type ProjectBackupPolicy = {
  retention: BackupRetentionSettings;
  automaticIntervalMinutes: number;
};

export type ProjectDocumentImportSettings = {
  storeOriginalFileName: boolean;
};

export type ProjectSettingsSnapshot = {
  aiAssistSettings: ProjectAiAssistSettings;
  aiAssistRuntimeStatus: ProjectAiAssistRuntimeStatus;
  documentImportSettings: ProjectDocumentImportSettings;
};

export const DEFAULT_PROJECT_BACKUP_RETENTION: BackupRetentionSettings = {
  hourlyHours: 24,
  dailyDays: 30,
  weeklyWeeks: 12,
};

export const DEFAULT_PROJECT_AUTO_BACKUP_INTERVAL_MINUTES = 15;
export const DEFAULT_PROJECT_DOCUMENT_IMPORT_SETTINGS: ProjectDocumentImportSettings = {
  storeOriginalFileName: true,
};

function legacyProjectAiAssistKey(projectId: string): string {
  return `kq_project_ai_assist_${projectId}`;
}

function readLegacyProjectAiAssistSettings(projectId: string): ProjectAiAssistSettings | null {
  try {
    const raw = localStorage.getItem(legacyProjectAiAssistKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProjectAiAssistSettings>;
    return {
      ...DEFAULT_PROJECT_AI_ASSIST_SETTINGS,
      ...parsed,
    };
  } catch {
    return null;
  }
}

function clearLegacyProjectAiAssistSettings(projectId: string): void {
  try {
    localStorage.removeItem(legacyProjectAiAssistKey(projectId));
  } catch {
    // Best-effort cleanup only.
  }
}

function clampWindow(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(3650, Math.floor(n)));
}

function normalizeRetention(value: unknown): BackupRetentionSettings {
  const settings = (value && typeof value === "object" ? value : {}) as Partial<BackupRetentionSettings>;
  return {
    hourlyHours: clampWindow(settings.hourlyHours, DEFAULT_PROJECT_BACKUP_RETENTION.hourlyHours),
    dailyDays: clampWindow(settings.dailyDays, DEFAULT_PROJECT_BACKUP_RETENTION.dailyDays),
    weeklyWeeks: clampWindow(settings.weeklyWeeks, DEFAULT_PROJECT_BACKUP_RETENTION.weeklyWeeks),
  };
}

function normalizeIntervalMinutes(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_PROJECT_AUTO_BACKUP_INTERVAL_MINUTES;
  return Math.max(1, Math.min(1440, Math.floor(n)));
}

function toProjectAiAssistSettings(record: Partial<RecordModel> | null | undefined): ProjectAiAssistSettings {
  return {
    enabled: Boolean(record?.ai_assist_enabled),
    allowSemanticSearch:
      typeof record?.ai_semantic_search_allowed === "boolean"
        ? Boolean(record.ai_semantic_search_allowed)
        : DEFAULT_PROJECT_AI_ASSIST_SETTINGS.allowSemanticSearch,
    allowQuestionAnswering:
      typeof record?.ai_question_answering_allowed === "boolean"
        ? Boolean(record.ai_question_answering_allowed)
        : DEFAULT_PROJECT_AI_ASSIST_SETTINGS.allowQuestionAnswering,
    allowSummaries:
      typeof record?.ai_summaries_allowed === "boolean"
        ? Boolean(record.ai_summaries_allowed)
        : DEFAULT_PROJECT_AI_ASSIST_SETTINGS.allowSummaries,
    allowCodeSuggestions:
      typeof record?.ai_code_suggestions_allowed === "boolean"
        ? Boolean(record.ai_code_suggestions_allowed)
        : DEFAULT_PROJECT_AI_ASSIST_SETTINGS.allowCodeSuggestions,
    allowDraftReports:
      typeof record?.ai_draft_reports_allowed === "boolean"
        ? Boolean(record.ai_draft_reports_allowed)
        : DEFAULT_PROJECT_AI_ASSIST_SETTINGS.allowDraftReports,
  };
}

function toProjectAiAssistRuntimeStatus(record: Partial<RecordModel> | null | undefined): ProjectAiAssistRuntimeStatus {
  return {
    hostEmbeddingModelInstalled:
      typeof record?.ai_host_embedding_model_installed === "boolean"
        ? Boolean(record.ai_host_embedding_model_installed)
        : DEFAULT_PROJECT_AI_ASSIST_RUNTIME_STATUS.hostEmbeddingModelInstalled,
    hostLlmEnabled:
      typeof record?.ai_host_llm_enabled === "boolean"
        ? Boolean(record.ai_host_llm_enabled)
        : DEFAULT_PROJECT_AI_ASSIST_RUNTIME_STATUS.hostLlmEnabled,
    hostLlmModelSelected:
      typeof record?.ai_host_llm_model_selected === "boolean"
        ? Boolean(record.ai_host_llm_model_selected)
        : DEFAULT_PROJECT_AI_ASSIST_RUNTIME_STATUS.hostLlmModelSelected,
    hostLlmConnectionLive:
      typeof record?.ai_host_llm_connection_live === "boolean"
        ? Boolean(record.ai_host_llm_connection_live)
        : DEFAULT_PROJECT_AI_ASSIST_RUNTIME_STATUS.hostLlmConnectionLive,
    hostProjectEmbeddingsReady:
      typeof record?.ai_host_project_embeddings_ready === "boolean"
        ? Boolean(record.ai_host_project_embeddings_ready)
        : DEFAULT_PROJECT_AI_ASSIST_RUNTIME_STATUS.hostProjectEmbeddingsReady,
    hostCheckedAt:
      typeof record?.ai_host_runtime_checked_at === "string"
        ? record.ai_host_runtime_checked_at
        : DEFAULT_PROJECT_AI_ASSIST_RUNTIME_STATUS.hostCheckedAt,
  };
}

function toProjectBackupPolicy(record: Partial<RecordModel> | null | undefined): ProjectBackupPolicy {
  return {
    retention: {
      hourlyHours: clampWindow(record?.backup_hourly_hours, DEFAULT_PROJECT_BACKUP_RETENTION.hourlyHours),
      dailyDays: clampWindow(record?.backup_daily_days, DEFAULT_PROJECT_BACKUP_RETENTION.dailyDays),
      weeklyWeeks: clampWindow(record?.backup_weekly_weeks, DEFAULT_PROJECT_BACKUP_RETENTION.weeklyWeeks),
    },
    automaticIntervalMinutes: normalizeIntervalMinutes(record?.backup_automatic_interval_minutes),
  };
}

function toProjectDocumentImportSettings(record: Partial<RecordModel> | null | undefined): ProjectDocumentImportSettings {
  return {
    storeOriginalFileName:
      typeof record?.document_import_store_original_file_name === "boolean"
        ? Boolean(record.document_import_store_original_file_name)
        : DEFAULT_PROJECT_DOCUMENT_IMPORT_SETTINGS.storeOriginalFileName,
  };
}

function toProjectSettingsPayload(
  projectId: string,
  aiAssistSettings: ProjectAiAssistSettings,
  backupPolicy: ProjectBackupPolicy,
  documentImportSettings: ProjectDocumentImportSettings,
) {
  return {
    project: projectId,
    ai_assist_enabled: aiAssistSettings.enabled,
    ai_semantic_search_allowed: aiAssistSettings.allowSemanticSearch,
    ai_question_answering_allowed: aiAssistSettings.allowQuestionAnswering,
    ai_summaries_allowed: aiAssistSettings.allowSummaries,
    ai_code_suggestions_allowed: aiAssistSettings.allowCodeSuggestions,
    ai_draft_reports_allowed: aiAssistSettings.allowDraftReports,
    backup_hourly_hours: backupPolicy.retention.hourlyHours,
    backup_daily_days: backupPolicy.retention.dailyDays,
    backup_weekly_weeks: backupPolicy.retention.weeklyWeeks,
    backup_automatic_interval_minutes: backupPolicy.automaticIntervalMinutes,
    document_import_store_original_file_name: documentImportSettings.storeOriginalFileName,
  };
}

async function getProjectSettingsRecord(pb: PocketBase, projectId: string): Promise<RecordModel | null> {
  return pb.collection("project_settings").getFirstListItem(`project="${projectId}"`).catch(() => null);
}

async function ensureProjectSettingsRecord(
  pb: PocketBase,
  projectId: string,
  legacy?: {
    aiAssistSettings?: ProjectAiAssistSettings | null;
    backupPolicy?: ProjectBackupPolicy | null;
    documentImportSettings?: ProjectDocumentImportSettings | null;
  },
): Promise<RecordModel> {
  const existing = await getProjectSettingsRecord(pb, projectId);
  if (existing) {
    const needsBackupBackfill =
      legacy?.backupPolicy
      && (
        existing.backup_hourly_hours == null
        || existing.backup_daily_days == null
        || existing.backup_weekly_weeks == null
        || existing.backup_automatic_interval_minutes == null
      );
    if (needsBackupBackfill) {
      const updated = await pb.collection("project_settings").update(
        existing.id,
        toProjectSettingsPayload(
          projectId,
          toProjectAiAssistSettings(existing),
          {
            retention: normalizeRetention(legacy.backupPolicy?.retention),
            automaticIntervalMinutes: normalizeIntervalMinutes(legacy.backupPolicy?.automaticIntervalMinutes),
          },
          toProjectDocumentImportSettings(existing),
        ),
      );
      clearLegacyProjectAiAssistSettings(projectId);
      return updated;
    }
    const needsDocumentImportBackfill =
      legacy?.documentImportSettings
      && existing.document_import_store_original_file_name == null;
    if (needsDocumentImportBackfill) {
      const updated = await pb.collection("project_settings").update(
        existing.id,
        toProjectSettingsPayload(
          projectId,
          toProjectAiAssistSettings(existing),
          toProjectBackupPolicy(existing),
          legacy.documentImportSettings ?? DEFAULT_PROJECT_DOCUMENT_IMPORT_SETTINGS,
        ),
      );
      clearLegacyProjectAiAssistSettings(projectId);
      return updated;
    }
    clearLegacyProjectAiAssistSettings(projectId);
    return existing;
  }

  const legacySettings = legacy?.aiAssistSettings ?? readLegacyProjectAiAssistSettings(projectId);
  const legacyBackupPolicy = legacy?.backupPolicy ?? {
    retention: DEFAULT_PROJECT_BACKUP_RETENTION,
    automaticIntervalMinutes: DEFAULT_PROJECT_AUTO_BACKUP_INTERVAL_MINUTES,
  };
  const legacyDocumentImportSettings =
    legacy?.documentImportSettings ?? DEFAULT_PROJECT_DOCUMENT_IMPORT_SETTINGS;
  const created = await pb.collection("project_settings").create(
    toProjectSettingsPayload(
      projectId,
      legacySettings ?? DEFAULT_PROJECT_AI_ASSIST_SETTINGS,
      {
        retention: normalizeRetention(legacyBackupPolicy.retention),
        automaticIntervalMinutes: normalizeIntervalMinutes(legacyBackupPolicy.automaticIntervalMinutes),
      },
      legacyDocumentImportSettings,
    ),
  );
  clearLegacyProjectAiAssistSettings(projectId);
  return created;
}

export async function loadProjectAiAssistSettings(
  pb: PocketBase,
  projectId: string,
): Promise<ProjectAiAssistSettings> {
  const record = await ensureProjectSettingsRecord(pb, projectId);
  return toProjectAiAssistSettings(record);
}

export async function loadProjectSettingsSnapshot(
  pb: PocketBase,
  projectId: string,
  legacy?: {
    documentImportSettings?: ProjectDocumentImportSettings | null;
  },
): Promise<ProjectSettingsSnapshot> {
  const record = await ensureProjectSettingsRecord(pb, projectId, {
    documentImportSettings: legacy?.documentImportSettings ?? undefined,
  });
  return {
    aiAssistSettings: toProjectAiAssistSettings(record),
    aiAssistRuntimeStatus: toProjectAiAssistRuntimeStatus(record),
    documentImportSettings: toProjectDocumentImportSettings(record),
  };
}

export async function saveProjectAiAssistRuntimeStatus(
  pb: PocketBase,
  projectId: string,
  status: ProjectAiAssistRuntimeStatus,
): Promise<ProjectAiAssistRuntimeStatus> {
  const record = await ensureProjectSettingsRecord(pb, projectId);
  const updated = await pb.collection("project_settings").update(record.id, {
    ai_host_embedding_model_installed: status.hostEmbeddingModelInstalled,
    ai_host_llm_enabled: status.hostLlmEnabled,
    ai_host_llm_model_selected: status.hostLlmModelSelected,
    ai_host_llm_connection_live: status.hostLlmConnectionLive,
    ai_host_project_embeddings_ready: status.hostProjectEmbeddingsReady,
    ai_host_runtime_checked_at: status.hostCheckedAt,
  });
  return toProjectAiAssistRuntimeStatus(updated);
}

export async function saveProjectAiAssistSettings(
  pb: PocketBase,
  projectId: string,
  settings: ProjectAiAssistSettings,
): Promise<ProjectAiAssistSettings> {
  const record = await ensureProjectSettingsRecord(pb, projectId);
  const backupPolicy = toProjectBackupPolicy(record);
  const documentImportSettings = toProjectDocumentImportSettings(record);
  const updated = await pb.collection("project_settings").update(
    record.id,
    toProjectSettingsPayload(projectId, settings, backupPolicy, documentImportSettings),
  );
  clearLegacyProjectAiAssistSettings(projectId);
  return toProjectAiAssistSettings(updated);
}

export function projectAiAssistSettingsFromRecord(record: Partial<RecordModel> | null | undefined): ProjectAiAssistSettings {
  return toProjectAiAssistSettings(record);
}

export function projectAiAssistRuntimeStatusFromRecord(
  record: Partial<RecordModel> | null | undefined,
): ProjectAiAssistRuntimeStatus {
  return toProjectAiAssistRuntimeStatus(record);
}

export async function loadProjectBackupPolicy(
  pb: PocketBase,
  projectId: string,
  legacyPolicy?: ProjectBackupPolicy | null,
): Promise<ProjectBackupPolicy> {
  const record = await ensureProjectSettingsRecord(pb, projectId, { backupPolicy: legacyPolicy ?? undefined });
  return toProjectBackupPolicy(record);
}

export async function saveProjectBackupPolicy(
  pb: PocketBase,
  projectId: string,
  policy: ProjectBackupPolicy,
): Promise<ProjectBackupPolicy> {
  const record = await ensureProjectSettingsRecord(pb, projectId);
  const aiAssistSettings = toProjectAiAssistSettings(record);
  const documentImportSettings = toProjectDocumentImportSettings(record);
  const normalizedPolicy = {
    retention: normalizeRetention(policy.retention),
    automaticIntervalMinutes: normalizeIntervalMinutes(policy.automaticIntervalMinutes),
  };
  const updated = await pb.collection("project_settings").update(
    record.id,
    toProjectSettingsPayload(projectId, aiAssistSettings, normalizedPolicy, documentImportSettings),
  );
  return toProjectBackupPolicy(updated);
}

export function projectBackupPolicyFromRecord(record: Partial<RecordModel> | null | undefined): ProjectBackupPolicy {
  return toProjectBackupPolicy(record);
}

export async function loadProjectDocumentImportSettings(
  pb: PocketBase,
  projectId: string,
  legacySettings?: ProjectDocumentImportSettings | null,
): Promise<ProjectDocumentImportSettings> {
  const record = await ensureProjectSettingsRecord(pb, projectId, {
    documentImportSettings: legacySettings ?? undefined,
  });
  return toProjectDocumentImportSettings(record);
}

export async function saveProjectDocumentImportSettings(
  pb: PocketBase,
  projectId: string,
  settings: ProjectDocumentImportSettings,
): Promise<ProjectDocumentImportSettings> {
  const record = await ensureProjectSettingsRecord(pb, projectId);
  const updated = await pb.collection("project_settings").update(
    record.id,
    toProjectSettingsPayload(
      projectId,
      toProjectAiAssistSettings(record),
      toProjectBackupPolicy(record),
      {
        storeOriginalFileName: Boolean(settings.storeOriginalFileName),
      },
    ),
  );
  return toProjectDocumentImportSettings(updated);
}

export function projectDocumentImportSettingsFromRecord(
  record: Partial<RecordModel> | null | undefined,
): ProjectDocumentImportSettings {
  return toProjectDocumentImportSettings(record);
}
