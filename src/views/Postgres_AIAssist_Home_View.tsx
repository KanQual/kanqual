import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  readAppSettings,
  saveAppSettings,
  type AppSettings,
  type CloudLlmProvider,
  type LlmConnectionMode,
  type LocalLlmProvider,
} from "../lib/appSettings";
import {
  buildPostgresProjectEmbeddingStore,
  deletePostgresProjectEmbeddingStore,
  getPostgresEmbeddingModelDownloadStatus,
  getPostgresEmbeddingModelStatus,
  getPostgresProjectAiAssistSettings,
  getPostgresProjectAiAssistRuntimeStatus,
  getPostgresInstallationSettings,
  listPostgresEnabledAiLlmCatalog,
  savePostgresInstallationSettings,
  savePostgresProjectAiAssistSettings,
  type PostgresAiLlmCatalogEntry,
  type PostgresAuthSession,
  type PostgresEmbeddingModelDownloadStatus,
  type PostgresInstallationSettings,
  type PostgresEmbeddingModelStatus,
  type PostgresProject,
  type PostgresProjectAiAssistSettings,
  type PostgresProjectAiAssistRuntimeStatus,
} from "../lib/postgres";
import {
  buildPostgresProjectEmbeddingSourcesFingerprint,
  buildPostgresProjectEmbeddingSourcesForProject,
  type ProjectEmbeddingBuildStatus,
  type ProjectEmbeddingStoreStatus,
} from "../lib/projectEmbeddings";
import { formatCurrentDateTime } from "../i18n/formatters";

type OllamaModelSummary = {
  name: string;
  size: number | null;
  modifiedAt: string | null;
};

type OllamaDiscoveryResult = {
  ok: boolean;
  baseUrl: string;
  version: string | null;
  modelCount: number;
  models: OllamaModelSummary[];
  message: string;
};

type CloudLlmModelSummary = {
  id: string;
  name: string;
  publisher: string | null;
};

type CloudLlmDiscoveryResult = {
  ok: boolean;
  provider: string;
  baseUrl: string;
  version: string | null;
  modelCount: number;
  models: CloudLlmModelSummary[];
  message: string;
};

const CLOUD_PROVIDER_OPTIONS: Array<{
  value: CloudLlmProvider;
  label: string;
  keyUrl: string;
  helpText: string;
}> = [
  {
    value: "openai",
    label: "OpenAI",
    keyUrl: "https://platform.openai.com/api-keys",
    helpText: "Create a project API key from your OpenAI dashboard.",
  },
  {
    value: "anthropic",
    label: "Anthropic",
    keyUrl: "https://console.anthropic.com/settings/keys",
    helpText: "Create an API key from your Anthropic Console settings.",
  },
  {
    value: "copilot",
    label: "Copilot",
    keyUrl: "https://github.com/settings/personal-access-tokens/new",
    helpText: "Generate a GitHub token that includes the Copilot or GitHub Models access you plan to use.",
  },
  {
    value: "blablador",
    label: "Blablador",
    keyUrl: "https://sdlaml.pages.jsc.fz-juelich.de/ai/guides/blablador_api_access/",
    helpText: "Follow the Blablador token guide to create a personal API token.",
  },
  {
    value: "ollama",
    label: "Ollama",
    keyUrl: "https://ollama.com/settings/keys",
    helpText: "Generate or copy your Ollama cloud key from the Ollama keys page.",
  },
];

const LOCAL_PROVIDER_OPTIONS: Array<{
  value: LocalLlmProvider;
  label: string;
  helpText: string;
  defaults?: Pick<AppSettings["llm"], "ollamaProtocol" | "ollamaHost" | "ollamaPort">;
}> = [
  {
    value: "ollama",
    label: "Ollama",
    helpText: "Uses Ollama's local API.",
    defaults: { ollamaProtocol: "http", ollamaHost: "127.0.0.1", ollamaPort: 11434 },
  },
  {
    value: "llamacpp",
    label: "llama.cpp",
    helpText: "Uses a local OpenAI-compatible /v1 API.",
    defaults: { ollamaProtocol: "http", ollamaHost: "127.0.0.1", ollamaPort: 8080 },
  },
  {
    value: "custom",
    label: "Custom",
    helpText: "Uses a local OpenAI-compatible /v1 API at the configured endpoint.",
    defaults: { ollamaProtocol: "http", ollamaHost: "", ollamaPort: 0 },
  },
];

export type PostgresAiAssistHomeViewProps = {
  project: PostgresProject;
  authSession: PostgresAuthSession;
  canManageProject: boolean;
  canManageEmbeddings: boolean;
};

const DEFAULT_AI_ASSIST_SETTINGS: PostgresProjectAiAssistSettings = {
  enabled: false,
  allowSemanticSearch: true,
  allowQuestionAnswering: true,
  allowSummaries: true,
  allowCodeSuggestions: false,
  allowDraftReports: false,
  embeddingChunkSize: 1800,
  embeddingOverlapSize: 100,
  embeddingBatchSize: 16,
  embeddingPrefixPassages: true,
  embeddingNormalizeWhitespace: true,
};

const DEFAULT_AI_ASSIST_RUNTIME_STATUS: PostgresProjectAiAssistRuntimeStatus = {
  hostEmbeddingModelInstalled: null,
  hostLlmEnabled: null,
  hostLlmModelSelected: null,
  hostLlmConnectionLive: null,
  hostProjectEmbeddingsReady: null,
  hostCheckedAt: "",
};

function formatDateTime(value: number | string | null | undefined): string {
  if (!value) return "No run yet";
  try {
    return formatCurrentDateTime(value);
  } catch {
    return "No run yet";
  }
}

function formatPercent(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value)}%` : "Working";
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function syncLocalLlmSettings(settings: AppSettings["llm"]): AppSettings {
  const current = readAppSettings();
  const next = {
    ...current,
    llm: settings,
  };
  saveAppSettings(next);
  return next;
}

function DeviceDetailsModal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide app-settings-modal" onClick={(event) => event.stopPropagation()}>
        <div className="settings-section-header modal-title-bar">
          <div>
            <h2 className="settings-section-title">{title}</h2>
          </div>
          <button type="button" className="modal-icon-close" onClick={onClose} aria-label="Close" title="Close">
            x
          </button>
        </div>
        <div className="app-settings-modal-body">
          <div className="app-settings-modal-sections">
            <section className="app-settings-modal-section">
              <div className="app-settings-modal-section-body">{children}</div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmbeddingBuildModal({
  open,
  hasExistingIndex,
  busy,
  onClose,
  onRun,
}: {
  open: boolean;
  hasExistingIndex: boolean;
  busy: boolean;
  onClose: () => void;
  onRun: () => void;
}) {
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide app-settings-modal" onClick={(event) => event.stopPropagation()}>
        <div className="settings-section-header modal-title-bar">
          <div>
            <h2 className="settings-section-title">
              {hasExistingIndex ? "Rebuild project embeddings" : "Build project embeddings"}
            </h2>
            <p className="project-model-modal-copy">
              AI Assist will index PostgreSQL project sources, objects, codes, annotations, and memos.
            </p>
          </div>
          <button type="button" className="modal-icon-close" onClick={onClose} disabled={busy} aria-label="Close" title="Close">
            x
          </button>
        </div>
        <div className="app-settings-modal-body">
          <p>This can take a while for larger projects. You can keep working while the build runs.</p>
        </div>
        <div className="app-settings-modal-footer modal-actions">
          <button type="button" className="btn btn--primary" onClick={onRun} disabled={busy}>
            {busy ? "Starting..." : hasExistingIndex ? "Rebuild" : "Build"}
          </button>
        </div>
      </div>
    </div>
  );
}

function llmRuntimeReady(settings: AppSettings["llm"]): boolean {
  if (settings.connectionMode === "cloud") {
    return Boolean(settings.cloudProvider && settings.cloudApiSecret && settings.cloudSelectedModel);
  }
  if (settings.connectionMode === "local") {
    return Boolean(settings.ollamaEnabled && settings.ollamaHost.trim() && settings.ollamaPort > 0 && settings.ollamaSelectedModel);
  }
  return false;
}

export function PostgresAiAssistHomeView({
  project,
  authSession,
  canManageProject,
  canManageEmbeddings,
}: PostgresAiAssistHomeViewProps) {
  const [settings, setSettings] = useState<PostgresProjectAiAssistSettings>(DEFAULT_AI_ASSIST_SETTINGS);
  const [runtimeStatus, setRuntimeStatus] = useState<PostgresProjectAiAssistRuntimeStatus>(DEFAULT_AI_ASSIST_RUNTIME_STATUS);
  const [installationSettings, setInstallationSettings] = useState<PostgresInstallationSettings | null>(null);
  const [aiLlmCatalog, setAiLlmCatalog] = useState<PostgresAiLlmCatalogEntry[]>([]);
  const [appSettings, setAppSettings] = useState<AppSettings>(() => readAppSettings());
  const [embeddingModelStatus, setEmbeddingModelStatus] = useState<PostgresEmbeddingModelStatus | null>(null);
  const [embeddingModelDownloadStatus, setEmbeddingModelDownloadStatus] = useState<PostgresEmbeddingModelDownloadStatus | null>(null);
  const [indexStatus, setIndexStatus] = useState<ProjectEmbeddingStoreStatus | null>(null);
  const [buildStatus, setBuildStatus] = useState<ProjectEmbeddingBuildStatus | null>(null);
  const [embeddingItemCount, setEmbeddingItemCount] = useState(0);
  const [embeddingContentFingerprint, setEmbeddingContentFingerprint] = useState("");
  const [, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<"settings" | "build" | "cancel" | "delete" | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [activeDeviceModal, setActiveDeviceModal] = useState<null | "embedding-tuning" | "connection-settings" | "generation-defaults">(null);
  const [buildModalOpen, setBuildModalOpen] = useState(false);
  const [llmConnectionStatus, setLlmConnectionStatus] = useState<"checking" | "live" | "offline" | "disabled">("checking");
  const [ollamaBusy, setOllamaBusy] = useState(false);
  const [ollamaError, setOllamaError] = useState("");
  const [, setOllamaDiscovery] = useState<OllamaDiscoveryResult | null>(null);
  const [ollamaModels, setOllamaModels] = useState<OllamaModelSummary[]>([]);
  const [ollamaTestFlash, setOllamaTestFlash] = useState<null | "success" | "error">(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudError, setCloudError] = useState("");
  const [cloudNotice, setCloudNotice] = useState("");
  const [, setCloudDiscovery] = useState<CloudLlmDiscoveryResult | null>(null);
  const [cloudModels, setCloudModels] = useState<CloudLlmModelSummary[]>([]);
  const [cloudTestFlash, setCloudTestFlash] = useState<null | "success" | "error">(null);

  const isLocalWorkspace = project.accessMode !== "remote";
  const isLocalAdministrator = authSession.authKind === "postgres_admin" || authSession.user.role === "administrator";
  const canManageLlmSettings = isLocalWorkspace && (isLocalAdministrator || canManageProject);
  const currentBuildPhase = buildStatus?.projectId === project.id ? buildStatus.phase : "idle";
  const buildBusy = currentBuildPhase === "running" || currentBuildPhase === "cancelling";
  const embeddingDownloadPhase = embeddingModelDownloadStatus?.phase ?? "idle";
  const embeddingDownloadBusy = embeddingDownloadPhase === "downloading" || embeddingDownloadPhase === "cancelling";
  const hasEmbeddingModel = Boolean(embeddingModelStatus?.installed);
  const activeEmbeddingModelName = embeddingModelStatus?.displayName?.trim() || "multilingual-e5-large";
  const remoteEmbeddingModelInstalled = runtimeStatus.hostEmbeddingModelInstalled;
  const remoteEmbeddingsReady = runtimeStatus.hostProjectEmbeddingsReady;
  const remoteSelectedModel = runtimeStatus.hostLlmModelSelected;
  const remoteLlmEnabled = runtimeStatus.hostLlmEnabled;
  const remoteLlmConnectionLive = runtimeStatus.hostLlmConnectionLive;
  const projectEmbeddingLlmSettings: AppSettings["llm"] = useMemo(() => ({
    ...appSettings.llm,
    chunkSize: settings.embeddingChunkSize,
    overlapSize: settings.embeddingOverlapSize,
    batchSize: settings.embeddingBatchSize,
    prefixPassages: settings.embeddingPrefixPassages,
    normalizeWhitespace: settings.embeddingNormalizeWhitespace,
  }), [
    appSettings.llm,
    settings.embeddingBatchSize,
    settings.embeddingChunkSize,
    settings.embeddingNormalizeWhitespace,
    settings.embeddingOverlapSize,
    settings.embeddingPrefixPassages,
  ]);
  const runtimeReady = isLocalWorkspace
    ? llmRuntimeReady(appSettings.llm)
    : Boolean(remoteLlmEnabled && remoteSelectedModel);
  const llmConnectionMode = appSettings.llm.connectionMode;
  const enabledLocalCatalogEntries = aiLlmCatalog.filter((entry) => entry.scope === "local");
  const enabledCloudCatalogEntries = aiLlmCatalog.filter((entry) => entry.scope === "cloud");
  const enabledLocalProviderIds = new Set(enabledLocalCatalogEntries.map((entry) => entry.providerId));
  const enabledCloudProviderIds = new Set(enabledCloudCatalogEntries.map((entry) => entry.providerId));
  const enabledLocalProviderOptions = LOCAL_PROVIDER_OPTIONS.filter((provider) => enabledLocalProviderIds.has(provider.value));
  const enabledCloudProviderOptions = CLOUD_PROVIDER_OPTIONS.filter((provider) => enabledCloudProviderIds.has(provider.value));
  const enabledLocalModelsForProvider = enabledLocalCatalogEntries.filter((entry) => entry.providerId === appSettings.llm.localProvider);
  const enabledCloudModelsForProvider = enabledCloudCatalogEntries.filter((entry) => entry.providerId === appSettings.llm.cloudProvider);
  const enabledLocalModelIds = new Set(enabledLocalModelsForProvider.map((entry) => entry.modelId));
  const enabledCloudModelIds = new Set(enabledCloudModelsForProvider.map((entry) => entry.modelId));
  const selectedModel = appSettings.llm.connectionMode === "cloud"
    ? appSettings.llm.cloudSelectedModel
    : appSettings.llm.ollamaSelectedModel;
  const aiAssistAllowedByAdministrator =
    installationSettings == null
      ? true
      : installationSettings.aiAssistPolicy.mode === "enabled"
        ? true
        : installationSettings.aiAssistPolicy.mode === "project"
          ? installationSettings.aiAssistPolicy.projectOverrides[project.id] ?? true
          : false;
  const runtimeConnectionModeLabel = llmConnectionMode === "none"
    ? "None"
    : llmConnectionMode === "cloud"
      ? "Cloud"
      : "Local";
  const generationModelOptions = llmConnectionMode === "cloud"
    ? (cloudModels.length
      ? cloudModels
        .filter((model) => enabledCloudModelIds.has(model.id))
        .map((model) => ({
          id: model.id,
          label: `${model.name}${model.publisher ? ` (${model.publisher})` : ""}`,
        }))
      : enabledCloudModelsForProvider.map((model) => ({
        id: model.modelId,
        label: `${model.modelLabel}${model.modelPublisher ? ` (${model.modelPublisher})` : ""}`,
      })))
    : (ollamaModels.length
      ? ollamaModels
        .filter((model) => enabledLocalModelIds.has(model.name))
        .map((model) => ({
          id: model.name,
          label: model.name,
        }))
      : enabledLocalModelsForProvider.map((model) => ({
        id: model.modelId,
        label: model.modelLabel,
      })));
  const embeddingRuntimeStatusLabel = embeddingDownloadPhase === "downloading"
    ? "Downloading"
    : embeddingDownloadPhase === "cancelling"
      ? "Cancelling"
      : hasEmbeddingModel
        ? "Downloaded"
        : "None";
  const generationDefaultsAvailable = llmConnectionMode !== "none";
  const projectEmbeddingNeedsRerun = useMemo(() => {
    if (!isLocalWorkspace) {
      if (remoteEmbeddingsReady == null) return false;
      return !remoteEmbeddingsReady;
    }
    if (buildBusy) return false;
    if (!indexStatus?.exists) return true;
    if (indexStatus.contentFingerprint && embeddingContentFingerprint) {
      return indexStatus.contentFingerprint !== embeddingContentFingerprint;
    }
    return indexStatus.itemCount !== embeddingItemCount;
  }, [
    buildBusy,
    embeddingContentFingerprint,
    embeddingItemCount,
    indexStatus?.contentFingerprint,
    indexStatus?.exists,
    indexStatus?.itemCount,
    isLocalWorkspace,
    remoteEmbeddingsReady,
  ]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [installationSettings, enabledCatalog] = await Promise.all([
        getPostgresInstallationSettings(),
        listPostgresEnabledAiLlmCatalog(),
      ]);
      const nextAppSettings = {
        ...readAppSettings(),
        llm: {
          ...readAppSettings().llm,
          ...installationSettings.llm,
        },
      };
      const enabledLocalProviders = new Set(
        enabledCatalog
          .filter((entry) => entry.scope === "local")
          .map((entry) => entry.providerId),
      );
      const enabledCloudProviders = new Set(
        enabledCatalog
          .filter((entry) => entry.scope === "cloud")
          .map((entry) => entry.providerId),
      );
      const firstEnabledLocalProvider = enabledCatalog.find((entry) => entry.scope === "local")?.providerId as LocalLlmProvider | undefined;
      const firstEnabledCloudProvider = enabledCatalog.find((entry) => entry.scope === "cloud")?.providerId as CloudLlmProvider | undefined;
      if (nextAppSettings.llm.connectionMode === "local" && !enabledLocalProviders.has(nextAppSettings.llm.localProvider)) {
        nextAppSettings.llm.connectionMode = firstEnabledLocalProvider ? "local" : "none";
        nextAppSettings.llm.ollamaEnabled = Boolean(firstEnabledLocalProvider);
        if (firstEnabledLocalProvider) {
          nextAppSettings.llm.localProvider = firstEnabledLocalProvider;
          nextAppSettings.llm.ollamaSelectedModel = nextAppSettings.llm.localSelectedModelsByProvider[firstEnabledLocalProvider] ?? "";
        }
      }
      if (nextAppSettings.llm.connectionMode === "cloud" && !enabledCloudProviders.has(nextAppSettings.llm.cloudProvider)) {
        nextAppSettings.llm.connectionMode = firstEnabledCloudProvider ? "cloud" : "none";
        if (firstEnabledCloudProvider) {
          nextAppSettings.llm.cloudProvider = firstEnabledCloudProvider;
          nextAppSettings.llm.cloudSelectedModel = nextAppSettings.llm.cloudSelectedModelsByProvider[firstEnabledCloudProvider] ?? "";
        }
      }
      const enabledLocalModels = new Set(
        enabledCatalog
          .filter((entry) => entry.scope === "local" && entry.providerId === nextAppSettings.llm.localProvider)
          .map((entry) => entry.modelId),
      );
      if (nextAppSettings.llm.ollamaSelectedModel && !enabledLocalModels.has(nextAppSettings.llm.ollamaSelectedModel)) {
        nextAppSettings.llm.ollamaSelectedModel = "";
      }
      const enabledCloudModels = new Set(
        enabledCatalog
          .filter((entry) => entry.scope === "cloud" && entry.providerId === nextAppSettings.llm.cloudProvider)
          .map((entry) => entry.modelId),
      );
      if (nextAppSettings.llm.cloudSelectedModel && !enabledCloudModels.has(nextAppSettings.llm.cloudSelectedModel)) {
        nextAppSettings.llm.cloudSelectedModel = "";
      }
      setInstallationSettings(installationSettings);
      setAiLlmCatalog(enabledCatalog);
      setAppSettings(nextAppSettings);
      const [nextSettings, nextRuntimeStatus] = await Promise.all([
        getPostgresProjectAiAssistSettings(project.id),
        getPostgresProjectAiAssistRuntimeStatus(project.id),
      ]);
      const nextProjectEmbeddingLlmSettings = {
        ...nextAppSettings.llm,
        chunkSize: nextSettings.embeddingChunkSize,
        overlapSize: nextSettings.embeddingOverlapSize,
        batchSize: nextSettings.embeddingBatchSize,
        prefixPassages: nextSettings.embeddingPrefixPassages,
        normalizeWhitespace: nextSettings.embeddingNormalizeWhitespace,
      };
      const sources = await buildPostgresProjectEmbeddingSourcesForProject(project.id, nextProjectEmbeddingLlmSettings);
      const [nextModelStatus, nextDownloadStatus, nextIndexStatus, nextBuildStatus] = isLocalWorkspace
        ? await Promise.all([
          getPostgresEmbeddingModelStatus(),
          getPostgresEmbeddingModelDownloadStatus(),
          invoke<ProjectEmbeddingStoreStatus>("get_project_embedding_store_status", { projectId: project.id }),
          invoke<ProjectEmbeddingBuildStatus>("get_project_embedding_store_build_status"),
        ])
        : [null, null, {
          exists: Boolean(nextRuntimeStatus.hostProjectEmbeddingsReady),
          generatedAtMs: null,
          itemCount: 0,
        } as ProjectEmbeddingStoreStatus, null];
      setSettings(nextSettings);
      setRuntimeStatus(nextRuntimeStatus);
      setEmbeddingModelStatus(nextModelStatus);
      setEmbeddingModelDownloadStatus(nextDownloadStatus);
      setIndexStatus(nextIndexStatus);
      setBuildStatus(nextBuildStatus);
      setEmbeddingItemCount(sources.flatMap((source) => source.items).length);
      setEmbeddingContentFingerprint(buildPostgresProjectEmbeddingSourcesFingerprint(sources, nextProjectEmbeddingLlmSettings));
    } catch (loadError) {
      setError(describeUnknownError(loadError));
    } finally {
      setLoading(false);
    }
  }, [isLocalWorkspace, project.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!buildBusy && !embeddingDownloadBusy) return;
    const intervalId = window.setInterval(() => {
      if (buildBusy) {
        void invoke<ProjectEmbeddingBuildStatus>("get_project_embedding_store_build_status")
          .then(setBuildStatus)
          .catch((statusError) => setError(describeUnknownError(statusError)));
        void invoke<ProjectEmbeddingStoreStatus>("get_project_embedding_store_status", { projectId: project.id })
          .then(setIndexStatus)
          .catch(() => {});
      }
      if (embeddingDownloadBusy) {
        void getPostgresEmbeddingModelDownloadStatus()
          .then(setEmbeddingModelDownloadStatus)
          .catch((statusError) => setError(describeUnknownError(statusError)));
        void getPostgresEmbeddingModelStatus()
          .then(setEmbeddingModelStatus)
          .catch(() => {});
      }
    }, 1500);
    return () => window.clearInterval(intervalId);
  }, [buildBusy, embeddingDownloadBusy, project.id]);

  useEffect(() => {
    if (!isLocalWorkspace || buildStatus?.projectId !== project.id || buildStatus.phase !== "completed") return;
    let cancelled = false;
    void Promise.all([
      invoke<ProjectEmbeddingStoreStatus>("get_project_embedding_store_status", { projectId: project.id }),
      buildPostgresProjectEmbeddingSourcesForProject(project.id, projectEmbeddingLlmSettings),
    ])
      .then(([nextIndexStatus, sources]) => {
        if (cancelled) return;
        setIndexStatus(nextIndexStatus);
        setEmbeddingItemCount(sources.flatMap((source) => source.items).length);
        setEmbeddingContentFingerprint(buildPostgresProjectEmbeddingSourcesFingerprint(sources, projectEmbeddingLlmSettings));
      })
      .catch((statusError) => {
        if (!cancelled) setError(describeUnknownError(statusError));
      });
    return () => {
      cancelled = true;
    };
  }, [buildStatus?.phase, buildStatus?.projectId, isLocalWorkspace, project.id, projectEmbeddingLlmSettings]);

  useEffect(() => {
    if (!ollamaTestFlash) return;
    const timeoutId = window.setTimeout(() => setOllamaTestFlash(null), 1600);
    return () => window.clearTimeout(timeoutId);
  }, [ollamaTestFlash]);

  useEffect(() => {
    if (!cloudTestFlash) return;
    const timeoutId = window.setTimeout(() => setCloudTestFlash(null), 1600);
    return () => window.clearTimeout(timeoutId);
  }, [cloudTestFlash]);

  useEffect(() => {
    if (!isLocalWorkspace) {
      if (remoteLlmEnabled == null || remoteSelectedModel == null || remoteLlmConnectionLive == null) {
        setLlmConnectionStatus("checking");
        return;
      }
      if (!remoteLlmEnabled || !remoteSelectedModel) {
        setLlmConnectionStatus("disabled");
        return;
      }
      setLlmConnectionStatus(remoteLlmConnectionLive ? "live" : "offline");
      return;
    }

    if (appSettings.llm.connectionMode !== "local" || !appSettings.llm.ollamaEnabled) {
      setLlmConnectionStatus("disabled");
      return;
    }

    let cancelled = false;
    setLlmConnectionStatus("checking");
    void invoke<number>("ping_address", {
      host: appSettings.llm.ollamaHost,
      port: appSettings.llm.ollamaPort,
    })
      .then(() => {
        if (!cancelled) setLlmConnectionStatus("live");
      })
      .catch(() => {
        if (!cancelled) setLlmConnectionStatus("offline");
      });

    return () => {
      cancelled = true;
    };
  }, [
    appSettings.llm.connectionMode,
    appSettings.llm.ollamaEnabled,
    appSettings.llm.ollamaHost,
    appSettings.llm.ollamaPort,
    isLocalWorkspace,
    remoteLlmConnectionLive,
    remoteLlmEnabled,
    remoteSelectedModel,
  ]);

  async function persistAppSettings(next: AppSettings, successMessage?: string) {
    if (!installationSettings || !canManageLlmSettings) return;
    const previousAppSettings = appSettings;
    const previousInstallationSettings = installationSettings;
    setError("");
    setAppSettings(next);
    syncLocalLlmSettings(next.llm);
    try {
      const saved = await savePostgresInstallationSettings({
        ...installationSettings,
        llm: next.llm,
      }, project.id);
      setInstallationSettings(saved);
      setAppSettings(syncLocalLlmSettings(saved.llm));
      if (successMessage) setNotice(successMessage);
    } catch (saveError) {
      setInstallationSettings(previousInstallationSettings);
      setAppSettings(syncLocalLlmSettings(previousAppSettings.llm));
      setError(describeUnknownError(saveError));
    }
  }

  function handleLlmConnectionModeChange(mode: LlmConnectionMode) {
    if (!settings.enabled || !canManageLlmSettings) return;
    setOllamaError("");
    setOllamaTestFlash(null);
    setCloudError("");
    setCloudTestFlash(null);
    setCloudNotice("");
    void persistAppSettings({
      ...appSettings,
      llm: {
        ...appSettings.llm,
        connectionMode: mode,
        ollamaEnabled: mode === "local",
      },
    });
  }

  function handleCloudProviderChange(provider: CloudLlmProvider) {
    if (!settings.enabled || !canManageLlmSettings) return;
    setCloudNotice("");
    setCloudError("");
    setCloudDiscovery(null);
    setCloudModels([]);
    setCloudTestFlash(null);
    void persistAppSettings({
      ...appSettings,
      llm: {
        ...appSettings.llm,
        cloudProvider: provider,
        cloudSelectedModel: appSettings.llm.cloudSelectedModelsByProvider[provider] ?? "",
      },
    });
  }

  function handleLocalProviderChange(provider: LocalLlmProvider) {
    if (!settings.enabled || !canManageLlmSettings) return;
    const profile = LOCAL_PROVIDER_OPTIONS.find((option) => option.value === provider) ?? LOCAL_PROVIDER_OPTIONS[0];
    setOllamaError("");
    setOllamaTestFlash(null);
    setOllamaDiscovery(null);
    setOllamaModels([]);
    void persistAppSettings({
      ...appSettings,
      llm: {
        ...appSettings.llm,
        ...profile.defaults,
        localProvider: provider,
        ollamaSelectedModel: appSettings.llm.localSelectedModelsByProvider[provider] ?? "",
      },
    });
  }

  async function handleOllamaTestConnection() {
    if (!settings.enabled || !canManageLlmSettings) return;
    if (!appSettings.llm.ollamaHost.trim() || appSettings.llm.ollamaPort <= 0) {
      setOllamaError("Enter a host and port before testing the local provider.");
      setOllamaTestFlash("error");
      return;
    }
    setOllamaBusy(true);
    setOllamaError("");
    setOllamaTestFlash(null);
    try {
      const result = await invoke<OllamaDiscoveryResult>("discover_ollama_models", {
        request: {
          localProvider: appSettings.llm.localProvider,
          protocol: appSettings.llm.ollamaProtocol,
          host: appSettings.llm.ollamaHost,
          port: appSettings.llm.ollamaPort,
          timeoutSeconds: appSettings.llm.ollamaRequestTimeoutSeconds,
        },
      });
      setOllamaDiscovery(result);
      setOllamaModels(result.models);
      setOllamaTestFlash(result.ok ? "success" : "error");

      if (result.models.length > 0) {
        const hasSelectedModel = result.models.some((model) => model.name === appSettings.llm.ollamaSelectedModel);
        if (!hasSelectedModel) {
          const selectedModel = result.models[0].name;
          await persistAppSettings({
            ...appSettings,
            llm: {
              ...appSettings.llm,
              ollamaSelectedModel: selectedModel,
              localSelectedModelsByProvider: {
                ...appSettings.llm.localSelectedModelsByProvider,
                [appSettings.llm.localProvider]: selectedModel,
              },
            },
          });
        }
      } else if (appSettings.llm.ollamaSelectedModel) {
        await persistAppSettings({
          ...appSettings,
          llm: {
            ...appSettings.llm,
            ollamaSelectedModel: "",
            localSelectedModelsByProvider: {
              ...appSettings.llm.localSelectedModelsByProvider,
              [appSettings.llm.localProvider]: "",
            },
          },
        });
      }
    } catch (testError) {
      setOllamaDiscovery(null);
      setOllamaModels([]);
      setOllamaTestFlash("error");
      setOllamaError(describeUnknownError(testError));
    } finally {
      setOllamaBusy(false);
    }
  }

  async function handleCloudTestConnection() {
    if (!settings.enabled || !canManageLlmSettings) return;
    setCloudBusy(true);
    setCloudError("");
    setCloudNotice("");
    setCloudTestFlash(null);
    try {
      const result = await invoke<CloudLlmDiscoveryResult>("discover_cloud_llm_models", {
        request: {
          provider: appSettings.llm.cloudProvider,
          apiSecret: appSettings.llm.cloudApiSecret,
          timeoutSeconds: appSettings.llm.ollamaRequestTimeoutSeconds,
        },
      });
      setCloudDiscovery(result);
      setCloudModels(result.models);
      setCloudNotice(result.message);
      setCloudTestFlash(result.ok ? "success" : "error");

      if (result.models.length > 0) {
        const hasSelectedModel = result.models.some((model) => model.id === appSettings.llm.cloudSelectedModel);
        if (!hasSelectedModel) {
          const selectedModel = result.models[0].id;
          await persistAppSettings({
            ...appSettings,
            llm: {
              ...appSettings.llm,
              cloudSelectedModel: selectedModel,
              cloudSelectedModelsByProvider: {
                ...appSettings.llm.cloudSelectedModelsByProvider,
                [appSettings.llm.cloudProvider]: selectedModel,
              },
            },
          });
        }
      } else if (appSettings.llm.cloudSelectedModel) {
        await persistAppSettings({
          ...appSettings,
          llm: {
            ...appSettings.llm,
            cloudSelectedModel: "",
            cloudSelectedModelsByProvider: {
              ...appSettings.llm.cloudSelectedModelsByProvider,
              [appSettings.llm.cloudProvider]: "",
            },
          },
        });
      }
    } catch (testError) {
      setCloudDiscovery(null);
      setCloudModels([]);
      setCloudTestFlash("error");
      setCloudError(describeUnknownError(testError));
    } finally {
      setCloudBusy(false);
    }
  }

  async function persistSettings(next: PostgresProjectAiAssistSettings) {
    if (!canManageProject) return;
    const previousSettings = settings;
    const previousEmbeddingTuningSignature = [
      previousSettings.embeddingChunkSize,
      previousSettings.embeddingOverlapSize,
      previousSettings.embeddingBatchSize,
      previousSettings.embeddingPrefixPassages ? "prefix" : "plain",
      previousSettings.embeddingNormalizeWhitespace ? "normalize" : "raw",
    ].join("|");
    setSubmitting("settings");
    setNotice("");
    setError("");
    setSettings(next);
    try {
      const saved = await savePostgresProjectAiAssistSettings({
        projectId: project.id,
        settings: next,
      });
      setSettings(saved);
      const nextEmbeddingTuningSignature = [
        saved.embeddingChunkSize,
        saved.embeddingOverlapSize,
        saved.embeddingBatchSize,
        saved.embeddingPrefixPassages ? "prefix" : "plain",
        saved.embeddingNormalizeWhitespace ? "normalize" : "raw",
      ].join("|");
      if (isLocalWorkspace && nextEmbeddingTuningSignature !== previousEmbeddingTuningSignature) {
        const nextProjectEmbeddingLlmSettings = {
          ...appSettings.llm,
          chunkSize: saved.embeddingChunkSize,
          overlapSize: saved.embeddingOverlapSize,
          batchSize: saved.embeddingBatchSize,
          prefixPassages: saved.embeddingPrefixPassages,
          normalizeWhitespace: saved.embeddingNormalizeWhitespace,
        };
        const sources = await buildPostgresProjectEmbeddingSourcesForProject(project.id, nextProjectEmbeddingLlmSettings);
        setEmbeddingItemCount(sources.flatMap((source) => source.items).length);
        setEmbeddingContentFingerprint(buildPostgresProjectEmbeddingSourcesFingerprint(sources, nextProjectEmbeddingLlmSettings));
      }
      setNotice("AI Assist settings saved.");
    } catch (saveError) {
      setSettings(previousSettings);
      setError(describeUnknownError(saveError));
    } finally {
      setSubmitting(null);
    }
  }

  async function handleBuildEmbeddings(): Promise<boolean> {
    if (!settings.enabled || !isLocalWorkspace || !canManageEmbeddings || buildBusy) return false;
    setSubmitting("build");
    setNotice("");
    setError("");
    try {
      if (!hasEmbeddingModel) {
        setError(`Download ${activeEmbeddingModelName} before building project embeddings.`);
        return false;
      }
      const sources = await buildPostgresProjectEmbeddingSourcesForProject(project.id, projectEmbeddingLlmSettings);
      if (sources.length === 0 || sources.flatMap((source) => source.items).length === 0) {
        setError("Add project content before building AI Assist embeddings.");
        return false;
      }
      const status = await buildPostgresProjectEmbeddingStore({
        projectId: project.id,
        batchSize: projectEmbeddingLlmSettings.batchSize,
        chunkSize: projectEmbeddingLlmSettings.chunkSize,
        overlapSize: projectEmbeddingLlmSettings.overlapSize,
        prefixPassages: projectEmbeddingLlmSettings.prefixPassages,
        normalizeWhitespace: projectEmbeddingLlmSettings.normalizeWhitespace,
        sources,
      });
      setBuildStatus(status);
      setEmbeddingItemCount(sources.flatMap((source) => source.items).length);
      setEmbeddingContentFingerprint(buildPostgresProjectEmbeddingSourcesFingerprint(sources, projectEmbeddingLlmSettings));
      return true;
    } catch (buildError) {
      setError(describeUnknownError(buildError));
      return false;
    } finally {
      setSubmitting(null);
    }
  }

  async function handleDeleteEmbeddings() {
    if (!settings.enabled || !isLocalWorkspace || !canManageEmbeddings || buildBusy) return;
    setSubmitting("delete");
    setNotice("");
    setError("");
    try {
      const nextStatus = await deletePostgresProjectEmbeddingStore(project.id);
      setIndexStatus(nextStatus);
      const saved = await savePostgresProjectAiAssistSettings({
        projectId: project.id,
        settings: {
          ...settings,
          enabled: false,
        },
      });
      setSettings(saved);
      setNotice("Deleted project embeddings and disabled AI Assist.");
    } catch (deleteError) {
      setError(describeUnknownError(deleteError));
    } finally {
      setSubmitting(null);
    }
  }

  const llmModelSelector = (
    <div className="ai-assist-llm-model-selection-stack">
      <fieldset className="llm-settings-grid llm-settings-grid--single ai-assist-llm-model-selector" disabled={!settings.enabled || !canManageLlmSettings || !generationDefaultsAvailable} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <label className="form-label">
          LLM model
          <select
            className="form-input"
            value={llmConnectionMode === "cloud" ? appSettings.llm.cloudSelectedModel : appSettings.llm.ollamaSelectedModel}
            onChange={(event) => {
              const selectedModel = event.target.value;
              void persistAppSettings({
                ...appSettings,
                llm: {
                  ...appSettings.llm,
                  ...(llmConnectionMode === "cloud"
                    ? {
                      cloudSelectedModel: selectedModel,
                      cloudSelectedModelsByProvider: {
                        ...appSettings.llm.cloudSelectedModelsByProvider,
                        [appSettings.llm.cloudProvider]: selectedModel,
                      },
                    }
                    : {
                      ollamaSelectedModel: selectedModel,
                      localSelectedModelsByProvider: {
                        ...appSettings.llm.localSelectedModelsByProvider,
                        [appSettings.llm.localProvider]: selectedModel,
                      },
                    }),
                },
              });
            }}
            disabled={!settings.enabled || generationModelOptions.length === 0}
          >
            <option value="">{generationModelOptions.length === 0 ? "No models loaded yet" : "Select model"}</option>
            {generationModelOptions.map((model) => (
              <option key={model.id} value={model.id}>{model.label}</option>
            ))}
          </select>
        </label>
      </fieldset>
    </div>
  );

  return (
    <div className="view home-view ai-assist-home-view">
      <header className="view-header">
        <div>
          <h1>AI Assist</h1>
        </div>
      </header>

      {notice ? <p className="settings-success">{notice}</p> : null}
      {error ? <p className="auth-error">{error}</p> : null}

      {!aiAssistAllowedByAdministrator ? (
        <section className="home-project-card ai-assist-home-card">
          <div className="home-project-card-header">
            <h2>AI Assist unavailable</h2>
          </div>
          <p className="auth-hint">The administrator has disallowed AI Assist usage for this server or project.</p>
        </section>
      ) : (
      <div className="ai-assist-home-layout">
        <div className="ai-assist-home-info-column">
          <section className="home-project-card ai-assist-home-card ai-assist-home-status-card">
            <div className="home-project-card-header">
              <h2>Device-Level Status</h2>
            </div>
            <div className="home-restricted-list">
              <div className="home-restricted-item">
                <span className="home-restricted-label">Embedding model</span>
                <span className={`home-restricted-value${(isLocalWorkspace ? hasEmbeddingModel : remoteEmbeddingModelInstalled) ? " home-restricted-value--ready" : " home-restricted-value--pending"}`}>
                  {isLocalWorkspace
                    ? (embeddingDownloadBusy ? `${embeddingDownloadPhase === "cancelling" ? "Cancelling" : "Downloading"} ${formatPercent(embeddingModelDownloadStatus?.progressPercent)}` : hasEmbeddingModel ? "Ready" : "Missing")
                    : remoteEmbeddingModelInstalled == null
                      ? "Checking"
                      : remoteEmbeddingModelInstalled
                        ? "Ready on host"
                        : "Missing on host"}
                </span>
              </div>
              <div className="home-restricted-item">
                <span className="home-restricted-label">{isLocalWorkspace ? "LLM runtime" : "Host LLM"}</span>
                <span className={`home-restricted-value${runtimeReady ? " home-restricted-value--ready" : " home-restricted-value--pending"}`}>
                  {isLocalWorkspace
                    ? (runtimeReady ? runtimeConnectionModeLabel : "Not configured")
                    : remoteLlmEnabled == null
                      ? "Checking"
                      : remoteLlmEnabled
                        ? (llmConnectionStatus === "live" ? "Connected" : "Not ready")
                        : "Disabled"}
                </span>
              </div>
              <div className="home-restricted-item">
                <span className="home-restricted-label">Selected model</span>
                <span className={`home-restricted-value${(isLocalWorkspace ? selectedModel : remoteSelectedModel) ? " home-restricted-value--ready" : " home-restricted-value--pending"}`}>
                  {isLocalWorkspace
                    ? (selectedModel || "None selected")
                    : remoteSelectedModel == null
                      ? "Checking"
                  : remoteSelectedModel
                        ? "Selected on host"
                        : "None selected on host"}
                </span>
              </div>
            </div>
          </section>

          <section className="home-project-card ai-assist-home-card ai-assist-home-status-card">
            <div className="home-project-card-header">
              <h2>Project Readiness</h2>
            </div>
            <div className="home-restricted-list">
              <div className="home-restricted-item">
                <span className="home-restricted-label">AI Assist</span>
                <span className={`home-restricted-value${settings.enabled ? " home-restricted-value--ready" : " home-restricted-value--pending"}`}>
                  {settings.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <div className="home-restricted-item">
                <span className="home-restricted-label">Embeddings</span>
                <span className={`home-restricted-value${indexStatus?.exists ? " home-restricted-value--ready" : " home-restricted-value--pending"}`}>
                  {!isLocalWorkspace
                    ? remoteEmbeddingsReady == null
                      ? "Checking"
                      : remoteEmbeddingsReady
                        ? "Built on host"
                        : "Not built on host"
                    : buildBusy
                      ? `${currentBuildPhase === "cancelling" ? "Cancelling" : "Building"} ${formatPercent(buildStatus?.progressPercent)}`
                      : indexStatus?.exists ? "Built" : "Not built"}
                </span>
              </div>
              {isLocalWorkspace ? (
                <>
                  <div className="home-restricted-item">
                    <span className="home-restricted-label">Last run</span>
                    <span className="home-restricted-value">{formatDateTime(indexStatus?.generatedAtMs)}</span>
                  </div>
                </>
              ) : (
                <div className="home-restricted-item">
                  <span className="home-restricted-label">Host checked</span>
                  <span className="home-restricted-value">{runtimeStatus.hostCheckedAt || "Not checked yet"}</span>
                </div>
              )}
              <div className="home-restricted-item">
                <span className="home-restricted-label">Rerun status</span>
                <span className={`home-restricted-value${projectEmbeddingNeedsRerun ? " home-restricted-value--pending" : " home-restricted-value--ready"}`}>
                  {!isLocalWorkspace
                    ? remoteEmbeddingsReady == null
                      ? "Checking"
                      : remoteEmbeddingsReady ? "Up to date on host" : "Host run needed"
                    : projectEmbeddingNeedsRerun ? "Rerun recommended" : "Up to date"}
                </span>
              </div>
            </div>
          </section>
        </div>

        <div className="ai-assist-home-actions-column">
          <div className="ai-assist-home-tabbar">
            <div className="segmented-control" role="tablist" aria-label="Project AI Assist status">
              {([
                { value: false, label: "Disabled" },
                { value: true, label: "Enabled" },
              ] as const).map((option) => (
                <button
                  key={String(option.value)}
                  type="button"
                  role="tab"
                  aria-selected={settings.enabled === option.value}
                  className={settings.enabled === option.value ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                  disabled={!canManageProject || submitting === "settings"}
                  onClick={() => {
                    if (settings.enabled === option.value) return;
                    void persistSettings({ ...settings, enabled: option.value });
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {!canManageProject ? <p className="auth-hint">Only project owners or the PostgreSQL administrator can change AI Assist availability.</p> : null}
          </div>

            <section className="ai-assist-home-action-group">
              {!isLocalWorkspace ? (
                <section className="home-project-card ai-assist-home-card">
                  <div className="home-project-card-header">
                    <div>
                      <h2>Host Runtime</h2>
                      <p className="ai-assist-card-subcopy">This project uses AI runtime services managed by the PostgreSQL host.</p>
                    </div>
                  </div>
                  <div className="home-restricted-list">
                    <div className="home-restricted-item">
                      <span className="home-restricted-label">Embedding model</span>
                      <span className={`home-restricted-value${remoteEmbeddingModelInstalled ? " home-restricted-value--ready" : " home-restricted-value--pending"}`}>
                        {remoteEmbeddingModelInstalled == null ? "Checking" : remoteEmbeddingModelInstalled ? "Ready" : "Missing"}
                      </span>
                    </div>
                    <div className="home-restricted-item">
                      <span className="home-restricted-label">Host LLM</span>
                      <span className={`home-restricted-value${llmConnectionStatus === "live" ? " home-restricted-value--ready" : " home-restricted-value--pending"}`}>
                        {llmConnectionStatus === "checking" ? "Checking" : llmConnectionStatus === "live" ? "Connected" : "Not ready"}
                      </span>
                    </div>
                    <div className="home-restricted-item">
                      <span className="home-restricted-label">Selected model</span>
                      <span className={`home-restricted-value${remoteSelectedModel ? " home-restricted-value--ready" : " home-restricted-value--pending"}`}>
                        {remoteSelectedModel == null ? "Checking" : remoteSelectedModel ? "Selected on host" : "None selected on host"}
                      </span>
                    </div>
                    <div className="home-restricted-item">
                      <span className="home-restricted-label">Project embeddings</span>
                      <span className={`home-restricted-value${remoteEmbeddingsReady ? " home-restricted-value--ready" : " home-restricted-value--pending"}`}>
                        {remoteEmbeddingsReady == null ? "Checking" : remoteEmbeddingsReady ? "Ready" : "Not built"}
                      </span>
                    </div>
                    <div className="home-restricted-item">
                      <span className="home-restricted-label">Checked at</span>
                      <span className="home-restricted-value">{runtimeStatus.hostCheckedAt || "Not checked yet"}</span>
                    </div>
                  </div>
                </section>
              ) : (
                <>
              <div className="ai-assist-home-card-row">
                <section
                  className="home-project-card ai-assist-home-card ai-assist-home-card--balanced ai-assist-compact-setup-card ai-assist-embeddings-card"
                  style={{ gridColumn: "1 / -1" }}
                >
                  <div className="home-project-card-header">
                    <div>
                      <h2>Embeddings</h2>
                    </div>
                  </div>
                  <div className="project-model-card">
                    <div>
                      <div className="project-model-name">{activeEmbeddingModelName}</div>
                      <p className="project-model-description">Status: {embeddingRuntimeStatusLabel}</p>
                    </div>
                  </div>
                  <div className="project-model-card">
                    <div>
                      <div className="project-model-name">Settings</div>
                      <p className="project-model-description">Chunk size: {settings.embeddingChunkSize}</p>
                      <p className="project-model-description">Overlap: {settings.embeddingOverlapSize}</p>
                      <p className="project-model-description">Batch size: {settings.embeddingBatchSize}</p>
                    </div>
                  </div>
                  {!hasEmbeddingModel ? <div className="users-permission-note ai-assist-home-disabled-note">Download the embedding model first.</div> : null}
                  {!isLocalWorkspace ? <div className="users-permission-note">Project embedding builds run on the PostgreSQL host for remote projects.</div> : null}
                  {isLocalWorkspace && !canManageEmbeddings ? <div className="users-permission-note">Only project owners, editors, or the PostgreSQL administrator can manage embeddings.</div> : null}
                  <div className="project-export-actions project-export-actions--modal" style={{ justifyContent: "space-between" }}>
                    <button type="button" className="btn" onClick={() => setActiveDeviceModal("embedding-tuning")} disabled={!settings.enabled || !hasEmbeddingModel}>
                      Settings
                    </button>
                    {indexStatus?.exists ? (
                      <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => void handleDeleteEmbeddings()}
                        disabled={!settings.enabled || !isLocalWorkspace || buildBusy || submitting === "delete" || !canManageEmbeddings}
                      >
                        {submitting === "delete" ? "Deleting..." : "Delete"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => setBuildModalOpen(true)}
                        disabled={!settings.enabled || !isLocalWorkspace || buildBusy || !canManageEmbeddings}
                      >
                        {buildBusy ? "Generating..." : "Generate"}
                      </button>
                    )}
                  </div>
                </section>
              </div>

              <div className="ai-assist-home-card-row">
              <section className="home-project-card ai-assist-home-card ai-assist-llm-connection-card" style={{ gridColumn: "1 / -1" }}>
                <div className="home-project-card-header">
                  <div>
                    <h2>LLM Connection</h2>
                  </div>
                </div>
                <div className="settings-toggle-row settings-toggle-row--stacked settings-toggle-row--compact ai-assist-connection-mode-row">
                  <div className="segmented-control ai-assist-connection-mode-toggle" role="tablist" aria-label="Connection mode">
                    {(["local", "cloud"] as const).map((mode) => {
                      const modeUnavailable =
                        mode === "local"
                          ? enabledLocalProviderOptions.length === 0
                          : enabledCloudProviderOptions.length === 0;
                      return (
                        <button
                          key={mode}
                          type="button"
                          role="tab"
                          aria-selected={llmConnectionMode === mode}
                          className={llmConnectionMode === mode ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                          disabled={!settings.enabled || !canManageLlmSettings || modeUnavailable}
                          onClick={() => handleLlmConnectionModeChange(mode)}
                        >
                          {mode === "local" ? "Local" : "Cloud"}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {llmConnectionMode === "local" ? (
                  <>
                    {ollamaError ? <div className="form-error project-settings-error">{ollamaError}</div> : null}
                    <fieldset className="llm-settings-grid llm-settings-grid--single" disabled={!settings.enabled || !canManageLlmSettings} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
                      <label className="form-label">
                        API provider
                        <select className="form-input" value={appSettings.llm.localProvider} onChange={(event) => handleLocalProviderChange(event.target.value as LocalLlmProvider)}>
                          {enabledLocalProviderOptions.map((provider) => (
                            <option key={provider.value} value={provider.value}>{provider.label}</option>
                          ))}
                        </select>
                      </label>
                    </fieldset>
                    {llmModelSelector}
                    <div className="project-export-actions project-export-actions--modal llm-connection-actions llm-connection-actions--inline">
                      <button className="btn btn--primary" type="button" onClick={() => void handleOllamaTestConnection()} disabled={!settings.enabled || ollamaBusy || !canManageLlmSettings} style={{ marginLeft: "auto" }}>
                        {ollamaBusy ? "Testing..." : "Test"}
                      </button>
                    </div>
                  </>
                ) : null}
                {llmConnectionMode === "cloud" ? (
                  <>
                    {cloudError ? <div className="form-error project-settings-error">{cloudError}</div> : null}
                    {cloudNotice ? <div className="settings-success project-settings-success">{cloudNotice}</div> : null}
                    <fieldset className="llm-settings-grid llm-settings-grid--single" disabled={!settings.enabled || !canManageLlmSettings} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
                      <label className="form-label">
                        API provider
                        <select className="form-input" value={appSettings.llm.cloudProvider} onChange={(event) => handleCloudProviderChange(event.target.value as CloudLlmProvider)}>
                          {enabledCloudProviderOptions.map((provider) => (
                            <option key={provider.value} value={provider.value}>{provider.label}</option>
                          ))}
                        </select>
                      </label>
                    </fieldset>
                    {llmModelSelector}
                    <div className="project-export-actions project-export-actions--modal llm-connection-actions llm-connection-actions--inline">
                      <button className="btn btn--primary" type="button" onClick={() => void handleCloudTestConnection()} disabled={!settings.enabled || !canManageLlmSettings || cloudBusy} style={{ marginLeft: "auto" }}>
                        {cloudBusy ? "Testing..." : "Test"}
                      </button>
                    </div>
                  </>
                ) : null}
              </section>
              </div>
                </>
              )}
            </section>
        </div>
      </div>
      )}

      <DeviceDetailsModal
        open={activeDeviceModal === "embedding-tuning"}
        title={`${activeEmbeddingModelName} settings`}
        onClose={() => setActiveDeviceModal(null)}
      >
        <div className="llm-settings-grid">
          <label className="form-label">
            Chunk size
            <span className="settings-field-hint">Target characters per segment before overlap is applied.</span>
            <input
              className="form-input"
              type="number"
              min={100}
              max={20000}
              value={settings.embeddingChunkSize}
              onChange={(event) => {
                const chunkSize = clampInteger(Number(event.target.value), 100, 20000);
                const overlapSize = Math.min(settings.embeddingOverlapSize, Math.max(0, chunkSize - 1));
                void persistSettings({
                  ...settings,
                  embeddingChunkSize: chunkSize,
                  embeddingOverlapSize: overlapSize,
                });
              }}
            />
          </label>
          <label className="form-label">
            Overlap size
            <span className="settings-field-hint">Characters repeated across neighboring segments.</span>
            <input
              className="form-input"
              type="number"
              min={0}
              max={Math.max(0, settings.embeddingChunkSize - 1)}
              value={settings.embeddingOverlapSize}
              onChange={(event) => void persistSettings({
                ...settings,
                embeddingOverlapSize: clampInteger(Number(event.target.value), 0, Math.max(0, settings.embeddingChunkSize - 1)),
              })}
            />
          </label>
          <label className="form-label">
            Batch size
            <span className="settings-field-hint">Embedding requests grouped per batch.</span>
            <input
              className="form-input"
              type="number"
              min={1}
              max={256}
              value={settings.embeddingBatchSize}
              onChange={(event) => void persistSettings({
                ...settings,
                embeddingBatchSize: clampInteger(Number(event.target.value), 1, 256),
              })}
            />
          </label>
        </div>
      </DeviceDetailsModal>

      <DeviceDetailsModal
        open={activeDeviceModal === "connection-settings"}
        title="Connection settings"
        onClose={() => setActiveDeviceModal(null)}
      >
        <fieldset className="llm-settings-grid" disabled={!canManageLlmSettings} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          <label className="form-label">
            Protocol
            <span className="settings-field-hint">Use https only when your local endpoint serves TLS.</span>
            <select
              className="form-input"
              value={appSettings.llm.ollamaProtocol}
              onChange={(event) => void persistAppSettings({
                ...appSettings,
                llm: {
                  ...appSettings.llm,
                  ollamaProtocol: event.target.value === "https" ? "https" : "http",
                },
              })}
            >
              <option value="http">http</option>
              <option value="https">https</option>
            </select>
          </label>
          <label className="form-label">
            Host URL
            <span className="settings-field-hint">Hostname or IP for the local LLM server.</span>
            <input
              className="form-input"
              type="text"
              value={appSettings.llm.ollamaHost}
              onChange={(event) => void persistAppSettings({
                ...appSettings,
                llm: { ...appSettings.llm, ollamaHost: event.target.value },
              })}
            />
          </label>
          <label className="form-label">
            Port
            <span className="settings-field-hint">Default Ollama port is 11434.</span>
            <input
              className="form-input"
              type="number"
              min={appSettings.llm.localProvider === "custom" ? 0 : 1}
              max={65535}
              value={appSettings.llm.localProvider === "custom" && appSettings.llm.ollamaPort === 0 ? "" : appSettings.llm.ollamaPort}
              onChange={(event) => void persistAppSettings({
                ...appSettings,
                llm: {
                  ...appSettings.llm,
                  ollamaPort: appSettings.llm.localProvider === "custom" && event.target.value.trim() === ""
                    ? 0
                    : clampInteger(Number(event.target.value), 1, 65535),
                },
              })}
            />
          </label>
          <label className="form-label">
            Request timeout
            <span className="settings-field-hint">Seconds to wait while testing or generating.</span>
            <input
              className="form-input"
              type="number"
              min={5}
              max={600}
              value={appSettings.llm.ollamaRequestTimeoutSeconds}
              onChange={(event) => void persistAppSettings({
                ...appSettings,
                llm: {
                  ...appSettings.llm,
                  ollamaRequestTimeoutSeconds: clampInteger(Number(event.target.value), 5, 600),
                },
              })}
            />
          </label>
        </fieldset>
      </DeviceDetailsModal>

      <DeviceDetailsModal
        open={activeDeviceModal === "generation-defaults"}
        title="Generation defaults"
        onClose={() => setActiveDeviceModal(null)}
      >
        <fieldset className="llm-settings-grid" disabled={!canManageLlmSettings} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          <label className="form-label">
            Temperature
            <span className="settings-field-hint">Lower values make responses more consistent; higher values make them more varied.</span>
            <input
              className="form-input"
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={appSettings.llm.ollamaTemperature}
              onChange={(event) => void persistAppSettings({
                ...appSettings,
                llm: {
                  ...appSettings.llm,
                  ollamaTemperature: Math.max(0, Math.min(2, Number(event.target.value) || 0)),
                },
              })}
            />
          </label>
          <label className="form-label">
            Context window
            <span className="settings-field-hint">Maximum context tokens requested from the generation model.</span>
            <input
              className="form-input"
              type="number"
              min={256}
              max={131072}
              value={appSettings.llm.ollamaNumCtx}
              onChange={(event) => void persistAppSettings({
                ...appSettings,
                llm: {
                  ...appSettings.llm,
                  ollamaNumCtx: clampInteger(Number(event.target.value), 256, 131072),
                },
              })}
            />
          </label>
          <label className="form-label">
            Keep alive minutes
            <span className="settings-field-hint">How long the local model should remain loaded after use.</span>
            <input
              className="form-input"
              type="number"
              min={0}
              max={1440}
              value={appSettings.llm.ollamaKeepAliveMinutes}
              onChange={(event) => void persistAppSettings({
                ...appSettings,
                llm: {
                  ...appSettings.llm,
                  ollamaKeepAliveMinutes: clampInteger(Number(event.target.value), 0, 1440),
                },
              })}
            />
          </label>
          <label className="form-label">
            Relevant segment shortlist
            <span className="settings-field-hint">How many candidate segments retrieval should inspect.</span>
            <input
              className="form-input"
              type="number"
              min={1}
              max={50}
              value={appSettings.llm.ollamaRelevantSegmentsCandidateLimit}
              onChange={(event) => {
                const candidateLimit = clampInteger(Number(event.target.value), 1, 50);
                void persistAppSettings({
                  ...appSettings,
                  llm: {
                    ...appSettings.llm,
                    ollamaRelevantSegmentsCandidateLimit: candidateLimit,
                    ollamaRelevantSegmentsMaxResults: Math.min(
                      appSettings.llm.ollamaRelevantSegmentsMaxResults,
                      candidateLimit,
                    ),
                  },
                });
              }}
            />
          </label>
          <label className="form-label">
            Relevant segments returned
            <span className="settings-field-hint">Maximum retrieval matches inserted into generation prompts.</span>
            <input
              className="form-input"
              type="number"
              min={1}
              max={appSettings.llm.ollamaRelevantSegmentsCandidateLimit}
              value={appSettings.llm.ollamaRelevantSegmentsMaxResults}
              onChange={(event) => void persistAppSettings({
                ...appSettings,
                llm: {
                  ...appSettings.llm,
                  ollamaRelevantSegmentsMaxResults: clampInteger(
                    Number(event.target.value),
                    1,
                    appSettings.llm.ollamaRelevantSegmentsCandidateLimit,
                  ),
                },
              })}
            />
          </label>
        </fieldset>
      </DeviceDetailsModal>

      <EmbeddingBuildModal
        open={buildModalOpen}
        hasExistingIndex={!!indexStatus?.exists}
        busy={submitting === "build"}
        onClose={() => setBuildModalOpen(false)}
        onRun={() => {
          void handleBuildEmbeddings().then((started) => {
            if (started) {
              setBuildModalOpen(false);
            }
          });
        }}
      />
    </div>
  );
}
