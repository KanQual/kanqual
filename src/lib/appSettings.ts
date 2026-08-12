import type { LocaleCode } from "../i18n/types";

export type StartupSettings = {
  autoLoginLastUser: boolean;
  reopenLastProject: boolean;
};

export type UiSettings = {
  locale: LocaleCode;
};

export type DocumentImportMode = "upload" | "paste";

export type DocumentImportSettings = {
  defaultMode: DocumentImportMode;
  autoNameFromFile: boolean;
  trimImportedText: boolean;
  storeOriginalFileName: boolean;
  warnBeforeEmptyImport: boolean;
};

export type PrivacySecuritySettings = {
  maskFilePaths: boolean;
  clearRecentProjectsOnSignOut: boolean;
  forgetLoginIdentitiesOnLogout: boolean;
};

export type UpdateSettings = {
  autoCheck: boolean;
};

export type LlmConnectionMode = "none" | "local" | "cloud";

export type CloudLlmProvider = "openai" | "anthropic" | "copilot" | "blablador" | "ollama";
export type LocalLlmProvider = "ollama" | "llamacpp" | "custom";

export type LlmSettings = {
  chunkSize: number;
  overlapSize: number;
  batchSize: number;
  prefixPassages: boolean;
  prefixQueries: boolean;
  normalizeWhitespace: boolean;
  connectionMode: LlmConnectionMode;
  cloudProvider: CloudLlmProvider;
  cloudApiSecret: string;
  cloudSelectedModel: string;
  localProvider: LocalLlmProvider;
  ollamaEnabled: boolean;
  ollamaProtocol: "http" | "https";
  ollamaHost: string;
  ollamaPort: number;
  ollamaSelectedModel: string;
  ollamaRequestTimeoutSeconds: number;
  ollamaDocumentProcessingTimeoutSeconds: number;
  ollamaTemperature: number;
  ollamaNumCtx: number;
  ollamaKeepAliveMinutes: number;
  ollamaRelevantSegmentsCandidateLimit: number;
  ollamaRelevantSegmentsMaxResults: number;
};

export type AppSettings = {
  ui: UiSettings;
  startup: StartupSettings;
  documentImport: DocumentImportSettings;
  privacy: PrivacySecuritySettings;
  updates: UpdateSettings;
  llm: LlmSettings;
};

export const APP_SETTINGS_KEY = "kq_app_settings_v1";
export const LAST_PROJECT_ID_KEY = "kq_last_project_id";
export const RECENT_PROJECTS_KEY = "kq_recent_projects";

export const DEFAULT_APP_SETTINGS: AppSettings = {
  ui: {
    locale: "en",
  },
  startup: {
    autoLoginLastUser: false,
    reopenLastProject: false,
  },
  documentImport: {
    defaultMode: "upload",
    autoNameFromFile: true,
    trimImportedText: true,
    storeOriginalFileName: true,
    warnBeforeEmptyImport: true,
  },
  privacy: {
    maskFilePaths: false,
    clearRecentProjectsOnSignOut: false,
    forgetLoginIdentitiesOnLogout: false,
  },
  updates: {
    autoCheck: true,
  },
  llm: {
    chunkSize: 1800,
    overlapSize: 100,
    batchSize: 16,
    prefixPassages: true,
    prefixQueries: true,
    normalizeWhitespace: true,
    connectionMode: "none",
    cloudProvider: "openai",
    cloudApiSecret: "",
    cloudSelectedModel: "",
    localProvider: "ollama",
    ollamaEnabled: false,
    ollamaProtocol: "http",
    ollamaHost: "127.0.0.1",
    ollamaPort: 11434,
    ollamaSelectedModel: "",
    ollamaRequestTimeoutSeconds: 120,
    ollamaDocumentProcessingTimeoutSeconds: 1800,
    ollamaTemperature: 0.2,
    ollamaNumCtx: 8192,
    ollamaKeepAliveMinutes: 10,
    ollamaRelevantSegmentsCandidateLimit: 12,
    ollamaRelevantSegmentsMaxResults: 6,
  },
};

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalizeLlmSettings(value: Partial<LlmSettings> | undefined): LlmSettings {
  const chunkSize = clampInteger(value?.chunkSize, DEFAULT_APP_SETTINGS.llm.chunkSize, 100, 20000);
  const overlapSize = clampInteger(value?.overlapSize, DEFAULT_APP_SETTINGS.llm.overlapSize, 0, chunkSize - 1);
  const rawTemperature = Number(value?.ollamaTemperature);
  const ollamaTemperature = Number.isFinite(rawTemperature)
    ? Math.max(0, Math.min(2, rawTemperature))
    : DEFAULT_APP_SETTINGS.llm.ollamaTemperature;
  const ollamaRelevantSegmentsCandidateLimit = clampInteger(
    value?.ollamaRelevantSegmentsCandidateLimit,
    DEFAULT_APP_SETTINGS.llm.ollamaRelevantSegmentsCandidateLimit,
    1,
    50,
  );
  const ollamaRelevantSegmentsMaxResults = clampInteger(
    value?.ollamaRelevantSegmentsMaxResults,
    DEFAULT_APP_SETTINGS.llm.ollamaRelevantSegmentsMaxResults,
    1,
    ollamaRelevantSegmentsCandidateLimit,
  );
  const connectionMode =
    value?.connectionMode === "local" || value?.connectionMode === "cloud" || value?.connectionMode === "none"
      ? value.connectionMode
      : value?.ollamaEnabled
        ? "local"
        : DEFAULT_APP_SETTINGS.llm.connectionMode;
  const localProvider =
    value?.localProvider === "llamacpp" || value?.localProvider === "custom" || value?.localProvider === "ollama"
      ? value.localProvider
      : DEFAULT_APP_SETTINGS.llm.localProvider;
  return {
    chunkSize,
    overlapSize,
    batchSize: clampInteger(value?.batchSize, DEFAULT_APP_SETTINGS.llm.batchSize, 1, 256),
    prefixPassages: value?.prefixPassages ?? DEFAULT_APP_SETTINGS.llm.prefixPassages,
    prefixQueries: value?.prefixQueries ?? DEFAULT_APP_SETTINGS.llm.prefixQueries,
    normalizeWhitespace: value?.normalizeWhitespace ?? DEFAULT_APP_SETTINGS.llm.normalizeWhitespace,
    connectionMode,
    cloudProvider:
      value?.cloudProvider === "anthropic"
      || value?.cloudProvider === "copilot"
      || value?.cloudProvider === "blablador"
      || value?.cloudProvider === "ollama"
        ? value.cloudProvider
        : DEFAULT_APP_SETTINGS.llm.cloudProvider,
    cloudApiSecret: typeof value?.cloudApiSecret === "string" ? value.cloudApiSecret : "",
    cloudSelectedModel: typeof value?.cloudSelectedModel === "string" ? value.cloudSelectedModel : "",
    localProvider,
    ollamaEnabled: connectionMode === "local",
    ollamaProtocol: value?.ollamaProtocol === "https" ? "https" : DEFAULT_APP_SETTINGS.llm.ollamaProtocol,
    ollamaHost: typeof value?.ollamaHost === "string" && (localProvider === "custom" || value.ollamaHost.trim())
      ? value.ollamaHost.trim()
      : DEFAULT_APP_SETTINGS.llm.ollamaHost,
    ollamaPort: localProvider === "custom" && (value?.ollamaPort == null || Number(value.ollamaPort) === 0)
      ? 0
      : clampInteger(value?.ollamaPort, DEFAULT_APP_SETTINGS.llm.ollamaPort, 1, 65535),
    ollamaSelectedModel: typeof value?.ollamaSelectedModel === "string" ? value.ollamaSelectedModel : "",
    ollamaRequestTimeoutSeconds: clampInteger(
      value?.ollamaRequestTimeoutSeconds,
      DEFAULT_APP_SETTINGS.llm.ollamaRequestTimeoutSeconds,
      5,
      600,
    ),
    ollamaDocumentProcessingTimeoutSeconds: clampInteger(
      value?.ollamaDocumentProcessingTimeoutSeconds,
      DEFAULT_APP_SETTINGS.llm.ollamaDocumentProcessingTimeoutSeconds,
      30,
      3600,
    ),
    ollamaTemperature,
    ollamaNumCtx: clampInteger(value?.ollamaNumCtx, DEFAULT_APP_SETTINGS.llm.ollamaNumCtx, 256, 131072),
    ollamaKeepAliveMinutes: clampInteger(
      value?.ollamaKeepAliveMinutes,
      DEFAULT_APP_SETTINGS.llm.ollamaKeepAliveMinutes,
      0,
      1440,
    ),
    ollamaRelevantSegmentsCandidateLimit,
    ollamaRelevantSegmentsMaxResults,
  };
}

export function readAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(APP_SETTINGS_KEY);
    if (!raw) return DEFAULT_APP_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ui: {
        ...DEFAULT_APP_SETTINGS.ui,
        ...parsed.ui,
      },
      startup: {
        ...DEFAULT_APP_SETTINGS.startup,
        ...parsed.startup,
      },
      documentImport: {
        ...DEFAULT_APP_SETTINGS.documentImport,
        ...parsed.documentImport,
      },
      privacy: {
        ...DEFAULT_APP_SETTINGS.privacy,
        ...parsed.privacy,
      },
      updates: {
        ...DEFAULT_APP_SETTINGS.updates,
        ...parsed.updates,
      },
      llm: normalizeLlmSettings(parsed.llm),
    };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export function saveAppSettings(settings: AppSettings): void {
  localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings));
}

export function rememberLastProjectId(projectId: string): void {
  localStorage.setItem(LAST_PROJECT_ID_KEY, projectId);
}

export function getLastProjectId(): string | null {
  return localStorage.getItem(LAST_PROJECT_ID_KEY);
}

export function clearLastProjectId(): void {
  localStorage.removeItem(LAST_PROJECT_ID_KEY);
}

export function clearRecentProjects(): void {
  localStorage.removeItem(RECENT_PROJECTS_KEY);
}

export function formatBytes(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "0 B";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  if (sizeBytes < 1024 * 1024 * 1024) return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(sizeBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
