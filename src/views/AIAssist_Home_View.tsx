import { useCallback, useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useStore } from "../context/StoreContext";
import {
  formatBytes,
  readAppSettings,
  saveAppSettings,
  type AppSettings,
  type CloudLlmProvider,
  type LlmConnectionMode,
} from "../lib/appSettings";
import {
  buildProjectEmbeddingItems,
  buildProjectEmbeddingSources,
  type ProjectEmbeddingStoreStatus,
} from "../lib/projectEmbeddings";
import { HelpIcon } from "../components/AppIcons";
import { formatCurrentDateTime } from "../i18n/formatters";
import { useI18n } from "../i18n/provider";

type EmbeddingModelStatus = {
  installed: boolean;
  repoId: string;
  displayName: string;
  modelDir: string;
  files: number;
  bytes: number;
  downloadedAtMs: number | null;
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

function formatDownloadDate(value: number | null | undefined, fallback: string): string {
  if (!value) return fallback;
  try {
    return formatCurrentDateTime(value);
  } catch {
    return fallback;
  }
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function useEmbeddingRunState() {
  const { t } = useI18n();
  const {
    activeProject,
    documents,
    cases,
    codes,
    annotations,
    memos,
    projectEmbeddingBuildStatus,
    projectAiAssistRuntimeStatus,
    isLocalWorkspace,
    startProjectEmbeddingBuild,
  } = useStore();
  const [indexStatus, setIndexStatus] = useState<ProjectEmbeddingStoreStatus | null>(null);
  const [error, setError] = useState("");
  const [buildModalOpen, setBuildModalOpen] = useState(false);
  const busy =
    projectEmbeddingBuildStatus?.phase === "running" || projectEmbeddingBuildStatus?.phase === "cancelling";

  useEffect(() => {
    const projectId = activeProject?.id;
    if (!projectId) {
      setIndexStatus(null);
      setError("");
      return;
    }

    if (!isLocalWorkspace) {
      setIndexStatus(
        projectAiAssistRuntimeStatus.hostProjectEmbeddingsReady == null
          ? null
          : {
              exists: Boolean(projectAiAssistRuntimeStatus.hostProjectEmbeddingsReady),
              generatedAtMs: null,
              itemCount: 0,
              modelRepoId: null,
              modelDisplayName: null,
            },
      );
      setError("");
      return;
    }

    let cancelled = false;
    async function refreshStatuses() {
      try {
        const nextIndexStatus = await invoke<ProjectEmbeddingStoreStatus>(
          "get_project_embedding_store_status",
          { projectId },
        );
        if (cancelled) return;
        setIndexStatus(nextIndexStatus);
        setError("");
      } catch (nextError) {
        console.error("Failed to load AI Assist embedding status:", nextError);
        if (!cancelled) setError(t("aiAssist.home.messages.couldNotLoadEmbeddingRunDetails"));
      }
    }

    void refreshStatuses();
    return () => {
      cancelled = true;
    };
  }, [
    activeProject?.id,
    isLocalWorkspace,
    projectAiAssistRuntimeStatus.hostProjectEmbeddingsReady,
    projectEmbeddingBuildStatus?.phase,
    projectEmbeddingBuildStatus?.projectId,
    t,
  ]);

  async function handleRunEmbedding() {
    if (!activeProject) return false;
    setError("");

    try {
      if (isLocalWorkspace) {
        const latestModelStatus = await invoke<EmbeddingModelStatus>("get_multilingual_e5_status");
        if (!latestModelStatus.installed) {
          setError(t("aiAssist.home.messages.downloadModelBeforeBuildingEmbeddings"));
          return false;
        }

        const llmSettings = readAppSettings().llm;
        const sources = buildProjectEmbeddingSources(documents, cases, codes, annotations, memos, llmSettings);
        if (sources.length === 0) {
          setError(t("aiAssist.home.messages.noProjectContentToEmbed"));
          return false;
        }

        await startProjectEmbeddingBuild({
          projectId: activeProject.id,
          llmSettings,
          sources,
          successLog: {
            projectId: activeProject.id,
            action: "ai_assist.reindex",
            label: "Rebuilt local AI Assist embeddings",
          },
        });
      } else {
        if (projectAiAssistRuntimeStatus.hostEmbeddingModelInstalled === false) {
          setError(t("aiAssist.home.messages.hostNeedsModelBeforeBuilding"));
          return false;
        }
        await startProjectEmbeddingBuild({
          projectId: activeProject.id,
          llmSettings: {
            batchSize: 0,
            chunkSize: 0,
            overlapSize: 0,
            prefixPassages: false,
            normalizeWhitespace: true,
          },
          sources: [],
          successLog: {
            projectId: activeProject.id,
            action: "ai_assist.reindex",
            label: "Rebuilt host AI Assist embeddings",
          },
        });
      }
      return true;
    } catch (nextError) {
      console.error("Failed to rerun project embeddings:", nextError);
      setError(nextError instanceof Error ? nextError.message : t("aiAssist.home.messages.couldNotRerunProjectEmbeddings"));
      return false;
    }
  }

  return {
    activeProject,
    indexStatus,
    busy,
    error,
    buildModalOpen,
    setBuildModalOpen,
    handleRunEmbedding,
  };
}

function EmbeddingBuildModal({
  buildModalOpen,
  hasExistingIndex,
  onClose,
  onRun,
}: {
  buildModalOpen: boolean;
  hasExistingIndex: boolean;
  onClose: () => void;
  onRun: () => void;
}) {
  const { t } = useI18n();
  if (!buildModalOpen) return null;
  return (
    <div className="modal-overlay">
      <div
        className="modal modal--wide app-settings-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-assist-rerun-title"
      >
        <div className="settings-section-header">
          <div>
            <h2 id="ai-assist-rerun-title" className="settings-section-title">
              {hasExistingIndex ? t("aiAssist.home.buildModal.rebuildTitle") : t("aiAssist.home.buildModal.runTitle")}
            </h2>
            <p className="settings-section-desc">
              {t("aiAssist.home.buildModal.description")}
            </p>
          </div>
        </div>
        <div className="app-settings-modal-body">
          <div className="project-model-modal-copy">
            <p>{t("aiAssist.home.buildModal.body")}</p>
          </div>
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button type="button" className="btn btn--primary" onClick={onRun}>
              {hasExistingIndex ? t("aiAssist.home.buildModal.rerun") : t("aiAssist.home.buildModal.run")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeviceDetailsModal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal modal--wide app-settings-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-assist-device-modal-title"
      >
        <div className="settings-section-header">
          <div>
            <h2 id="ai-assist-device-modal-title" className="settings-section-title">{title}</h2>
          </div>
        </div>
        <div className="app-settings-modal-body">
          {children}
          <div className="form-actions">
            <button type="button" className="btn btn--primary" onClick={onClose}>
              {t("common.close")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AIAssistView() {
  const { t } = useI18n();
  const {
    pb,
    canCurrentUser,
    isLocalWorkspace,
    documents,
    cases,
    codes,
    annotations,
    memos,
    projectAiAssistRuntimeStatus,
    projectAiAssistSettings,
    updateProjectAiAssistSettings,
    projectEmbeddingBuildStatus,
    embeddingModelDownloadStatus,
    startEmbeddingModelDownload,
    cancelEmbeddingModelDownload,
    logAction,
  } = useStore();
  const {
    activeProject,
    indexStatus,
    busy: projectBuildBusy,
    error: projectBuildError,
    buildModalOpen,
    setBuildModalOpen,
    handleRunEmbedding,
  } = useEmbeddingRunState();

  const [appSettings, setAppSettings] = useState<AppSettings>(readAppSettings);
  const [embeddingModelStatus, setEmbeddingModelStatus] = useState<EmbeddingModelStatus | null>(null);
  const [embeddingModelPreflight, setEmbeddingModelPreflight] = useState<EmbeddingModelDownloadPreflight | null>(null);
  const [deviceNotice, setDeviceNotice] = useState("");
  const [deviceError, setDeviceError] = useState("");
  const [projectNotice, setProjectNotice] = useState("");
  const [projectError, setProjectError] = useState("");
  const [llmConnectionStatus, setLlmConnectionStatus] = useState<"checking" | "live" | "offline" | "disabled">(
    isLocalWorkspace
      ? (appSettings.llm.ollamaEnabled ? "checking" : "disabled")
      : "checking",
  );
  const [ollamaBusy, setOllamaBusy] = useState(false);
  const [ollamaError, setOllamaError] = useState("");
  const [ollamaDiscovery, setOllamaDiscovery] = useState<OllamaDiscoveryResult | null>(null);
  const [ollamaModels, setOllamaModels] = useState<OllamaModelSummary[]>([]);
  const [ollamaTestFlash, setOllamaTestFlash] = useState<null | "success" | "error">(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudError, setCloudError] = useState("");
  const [cloudDiscovery, setCloudDiscovery] = useState<CloudLlmDiscoveryResult | null>(null);
  const [cloudModels, setCloudModels] = useState<CloudLlmModelSummary[]>([]);
  const [cloudTestFlash, setCloudTestFlash] = useState<null | "success" | "error">(null);
  const [cloudNotice, setCloudNotice] = useState("");
  const [aiAssistDeletingIndex, setAiAssistDeletingIndex] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [setupTab, setSetupTab] = useState<"device" | "project">("device");
  const [activeDeviceModal, setActiveDeviceModal] = useState<
    null | "download-details" | "embedding-tuning" | "connection-settings" | "generation-defaults"
  >(null);
  const embeddingDownloadPhase = embeddingModelDownloadStatus?.phase ?? "idle";
  const embeddingDownloadActive =
    embeddingDownloadPhase === "downloading" || embeddingDownloadPhase === "cancelling";
  const embeddingModelInstalled = Boolean(embeddingModelStatus?.installed);
  const embeddingRuntimeStatusLabel =
    embeddingDownloadPhase === "downloading"
      ? t("aiAssist.home.statuses.downloading")
      : embeddingDownloadPhase === "cancelling"
        ? t("aiAssist.home.statuses.cancelling")
        : embeddingModelInstalled
          ? t("aiAssist.home.statuses.downloaded")
          : t("aiAssist.home.statuses.none");
  const llmConnectionMode = appSettings.llm.connectionMode;
  const selectedCloudProvider = CLOUD_PROVIDER_OPTIONS.find(
    (provider) => provider.value === appSettings.llm.cloudProvider,
  ) ?? CLOUD_PROVIDER_OPTIONS[0];
  const activeSelectedModel =
    llmConnectionMode === "cloud" ? appSettings.llm.cloudSelectedModel : appSettings.llm.ollamaSelectedModel;
  const runtimeConnectionModeLabel = llmConnectionMode === "none"
    ? t("aiAssist.home.statuses.none")
    : llmConnectionMode === "cloud"
      ? t("aiAssist.home.statuses.cloud")
      : t("aiAssist.home.statuses.local");
  const generationModelOptions = llmConnectionMode === "cloud"
    ? cloudModels.map((model) => ({
      id: model.id,
      label: `${model.name}${model.publisher ? ` (${model.publisher})` : ""}`,
    }))
    : ollamaModels.map((model) => ({
      id: model.name,
      label: model.name,
    }));
  const llmServerCardClassName =
    ollamaTestFlash === "success"
      ? "project-model-card project-model-card--success"
      : ollamaTestFlash === "error"
        ? "project-model-card project-model-card--error"
        : "project-model-card";
  const cloudProviderCardClassName =
    cloudTestFlash === "success"
      ? "project-model-card project-model-card--success"
      : cloudTestFlash === "error"
        ? "project-model-card project-model-card--error"
        : "project-model-card";

  const canViewAiAssistHome = canCurrentUser("viewAiAssistHome");
  const canManageLlmSettings = canCurrentUser("manageLlmSettings");
  const canDownloadEmbeddingModel = canCurrentUser("downloadEmbeddingModel");
  const canDeleteEmbeddingModel = canCurrentUser("deleteEmbeddingModel");
  const canEnableProjectAiAssist = canCurrentUser("enableProjectAiAssist");
  const canBuildProjectEmbeddings = canCurrentUser("buildEmbeddings");
  const canDeleteProjectEmbeddings = canCurrentUser("deleteEmbeddings");
  const embeddingTuningAvailable = embeddingModelInstalled;
  const generationDefaultsAvailable = llmConnectionMode !== "none";
  const embeddingTuningBlockedMessage = t("aiAssist.home.messages.downloadModelFirst");
  const generationDefaultsBlockedMessage = t("aiAssist.home.messages.setUpLlmFirst");

  const remoteEmbeddingModelInstalled = projectAiAssistRuntimeStatus.hostEmbeddingModelInstalled;
  const remoteEmbeddingsReady = projectAiAssistRuntimeStatus.hostProjectEmbeddingsReady;
  const projectBuildPhase = activeProject && projectEmbeddingBuildStatus?.projectId === activeProject.id
    ? projectEmbeddingBuildStatus.phase
    : "idle";
  const currentProjectEmbeddingItemCount = buildProjectEmbeddingItems(
    documents,
    cases,
    codes,
    annotations,
    memos,
    appSettings.llm,
  ).length;
  const embeddingStatusLabel =
    projectBuildPhase === "running"
      ? t("aiAssist.home.statuses.buildingInBackground")
      : projectBuildPhase === "cancelling"
        ? t("aiAssist.home.statuses.cancellingBuild")
        : indexStatus?.exists
          ? t("aiAssist.home.statuses.generated")
          : t("aiAssist.home.statuses.notBuilt");
  const embeddingLastRunLabel =
    projectBuildPhase === "running"
      ? t("aiAssist.home.statuses.runningNow")
      : projectBuildPhase === "cancelling"
        ? t("aiAssist.home.statuses.stoppingCurrentRun")
        : indexStatus?.generatedAtMs
          ? formatCurrentDateTime(indexStatus.generatedAtMs)
          : t("aiAssist.home.statuses.noRunYet");
  const projectEmbeddingNeedsRerun =
    projectBuildPhase === "running" || projectBuildPhase === "cancelling"
      ? false
      : indexStatus?.exists
        ? indexStatus.itemCount !== currentProjectEmbeddingItemCount
        : true;
  const projectEmbeddingRerunLabel =
    projectBuildPhase === "running"
      ? t("aiAssist.home.statuses.updatingNow")
      : projectBuildPhase === "cancelling"
        ? t("aiAssist.home.statuses.stoppingCurrentRun")
        : !indexStatus?.exists
          ? t("aiAssist.home.statuses.needsFirstRun")
          : projectEmbeddingNeedsRerun
            ? t("aiAssist.home.statuses.rerunRecommended")
            : t("aiAssist.home.statuses.upToDate");
  const refreshEmbeddingModelStatus = useCallback(() => {
    if (!isLocalWorkspace) return;
    invoke<EmbeddingModelStatus>("get_multilingual_e5_status")
      .then((status) => {
        setEmbeddingModelStatus(status);
      })
      .catch((error) => {
        console.error("Failed to load embedding model status:", error);
        setDeviceError(t("aiAssist.home.messages.couldNotLoadEmbeddingModelStatus"));
      });
  }, [isLocalWorkspace, t]);

  const refreshEmbeddingModelPreflight = useCallback(() => {
    if (!isLocalWorkspace) return;
    invoke<EmbeddingModelDownloadPreflight>("get_multilingual_e5_download_preflight")
      .then((preflight) => {
        setEmbeddingModelPreflight(preflight);
      })
      .catch((error) => {
        console.error("Failed to load embedding model preflight:", error);
      });
  }, [isLocalWorkspace]);

  useEffect(() => {
    refreshEmbeddingModelStatus();
    refreshEmbeddingModelPreflight();
  }, [refreshEmbeddingModelPreflight, refreshEmbeddingModelStatus]);

  useEffect(() => {
    const phase = embeddingModelDownloadStatus?.phase;
    if (!phase || phase === "idle" || phase === "downloading" || phase === "cancelling") return;
    refreshEmbeddingModelStatus();
    refreshEmbeddingModelPreflight();
  }, [embeddingModelDownloadStatus?.phase, refreshEmbeddingModelPreflight, refreshEmbeddingModelStatus]);

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
      if (
        projectAiAssistRuntimeStatus.hostLlmEnabled == null
        || projectAiAssistRuntimeStatus.hostLlmModelSelected == null
        || projectAiAssistRuntimeStatus.hostLlmConnectionLive == null
      ) {
        setLlmConnectionStatus("checking");
        return;
      }
      if (!projectAiAssistRuntimeStatus.hostLlmEnabled || !projectAiAssistRuntimeStatus.hostLlmModelSelected) {
        setLlmConnectionStatus("disabled");
        return;
      }
      setLlmConnectionStatus(projectAiAssistRuntimeStatus.hostLlmConnectionLive ? "live" : "offline");
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
    projectAiAssistRuntimeStatus.hostLlmConnectionLive,
    projectAiAssistRuntimeStatus.hostLlmEnabled,
    projectAiAssistRuntimeStatus.hostLlmModelSelected,
  ]);

  function persistAppSettings(next: AppSettings, notice?: string) {
    saveAppSettings(next);
    setAppSettings(next);
    setDeviceNotice(notice ?? "");
    setDeviceError("");
  }

  function handleLlmConnectionModeChange(mode: LlmConnectionMode) {
    if (!canManageLlmSettings) return;
    setOllamaError("");
    setOllamaTestFlash(null);
    setCloudError("");
    setCloudTestFlash(null);
    setCloudNotice("");
    persistAppSettings({
      ...appSettings,
      llm: {
        ...appSettings.llm,
        connectionMode: mode,
        ollamaEnabled: mode === "local",
      },
    });
  }

  function handleCloudProviderChange(provider: CloudLlmProvider) {
    if (!canManageLlmSettings) return;
    setCloudNotice("");
    setCloudError("");
    setCloudDiscovery(null);
    setCloudModels([]);
    setCloudTestFlash(null);
    persistAppSettings({
      ...appSettings,
      llm: {
        ...appSettings.llm,
        cloudProvider: provider,
        cloudSelectedModel: "",
      },
    });
  }

  function handleCloudSecretChange(secret: string) {
    if (!canManageLlmSettings) return;
    setCloudNotice("");
    setCloudError("");
    setCloudTestFlash(null);
    persistAppSettings({
      ...appSettings,
      llm: {
        ...appSettings.llm,
        cloudApiSecret: secret,
      },
    });
  }

  async function handleEmbeddingModelDownload() {
    if (!canDownloadEmbeddingModel) return;
    setDeviceError("");
    setDeviceNotice("");
    try {
      await startEmbeddingModelDownload();
      setDeviceNotice(t("aiAssist.home.messages.downloadStarted"));
    } catch (error) {
      console.error("Embedding model download failed:", error);
      setDeviceError(error instanceof Error ? error.message : t("aiAssist.home.messages.downloadFailed"));
    }
  }

  async function handleEmbeddingModelCancel() {
    if (!canDownloadEmbeddingModel) return;
    setDeviceError("");
    setDeviceNotice("");
    try {
      const status = await cancelEmbeddingModelDownload();
      if (status.phase === "cancelling") {
        setDeviceNotice(t("aiAssist.home.messages.downloadCancelling"));
      }
    } catch (error) {
      console.error("Embedding model cancel failed:", error);
      setDeviceError(error instanceof Error ? error.message : t("aiAssist.home.messages.couldNotCancelDownload"));
    }
  }

  async function handleEmbeddingModelClear() {
    if (!canDeleteEmbeddingModel) return;
    setDeviceError("");
    setDeviceNotice("");
    try {
      const status = await invoke<EmbeddingModelStatus>("clear_multilingual_e5_model", {
        authToken: pb?.authStore.token ?? "",
      });
      setEmbeddingModelStatus(status);
      refreshEmbeddingModelStatus();
      refreshEmbeddingModelPreflight();
      setDeviceNotice(t("aiAssist.home.messages.localModelFilesCleared"));
    } catch (error) {
      console.error("Embedding model clear failed:", error);
      setDeviceError(error instanceof Error ? error.message : t("aiAssist.home.messages.couldNotClearLocalModelFiles"));
    }
  }

  async function handleOllamaTestConnection() {
    if (!canManageLlmSettings) return;
    setOllamaBusy(true);
    setOllamaError("");
    setOllamaTestFlash(null);
    try {
      const result = await invoke<OllamaDiscoveryResult>("discover_ollama_models", {
        request: {
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
        const hasSelectedModel = result.models.some(
          (model) => model.name === appSettings.llm.ollamaSelectedModel,
        );
        if (!hasSelectedModel) {
          persistAppSettings({
            ...appSettings,
            llm: {
              ...appSettings.llm,
              ollamaSelectedModel: result.models[0].name,
            },
          });
        }
      } else if (appSettings.llm.ollamaSelectedModel) {
        persistAppSettings({
          ...appSettings,
          llm: {
            ...appSettings.llm,
            ollamaSelectedModel: "",
          },
        });
      }
    } catch (error) {
      console.error("Local LLM connection test failed:", error);
      setOllamaDiscovery(null);
      setOllamaModels([]);
      setOllamaTestFlash("error");
      setOllamaError(error instanceof Error ? error.message : t("aiAssist.home.messages.couldNotConnectConfiguredLlmServer"));
    } finally {
      setOllamaBusy(false);
    }
  }

  async function handleCloudTestConnection() {
    if (!canManageLlmSettings) return;
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
        const selectedId = appSettings.llm.cloudSelectedModel;
        const hasSelectedModel = result.models.some((model) => model.id === selectedId);
        if (!hasSelectedModel) {
          persistAppSettings({
            ...appSettings,
            llm: {
              ...appSettings.llm,
              cloudSelectedModel: result.models[0].id,
            },
          });
        }
      } else if (appSettings.llm.cloudSelectedModel) {
        persistAppSettings({
          ...appSettings,
          llm: {
            ...appSettings.llm,
            cloudSelectedModel: "",
          },
        });
      }
    } catch (error) {
      console.error("Cloud LLM connection test failed:", error);
      setCloudDiscovery(null);
      setCloudModels([]);
      setCloudTestFlash("error");
      setCloudError(error instanceof Error ? error.message : t("aiAssist.home.messages.couldNotConnectSelectedCloudProvider"));
    } finally {
      setCloudBusy(false);
    }
  }

  async function persistProjectAiAssist(nextEnabled: boolean, notice: string) {
    if (!activeProject || !canEnableProjectAiAssist) return;
    await updateProjectAiAssistSettings(activeProject.id, {
      ...projectAiAssistSettings,
      enabled: nextEnabled,
    });
    setProjectNotice(notice);
    setProjectError("");
  }

  async function handleProjectAiAssistEnabledChange(enabled: boolean) {
    if (!activeProject || !canEnableProjectAiAssist) return;
    setProjectError("");
    if (!enabled) {
      await persistProjectAiAssist(false, t("aiAssist.home.messages.projectAiAssistDisabled"));
      await logAction(
        activeProject.id,
        "project.ai_assist.update",
        t("projectLog.labels.projectAiAssistDisabled"),
        undefined,
        { enabled: false },
      );
      return;
    }

    await persistProjectAiAssist(
      true,
      t("aiAssist.home.messages.projectAiAssistEnabled"),
    );
    await logAction(
      activeProject.id,
      "project.ai_assist.update",
      t("projectLog.labels.projectAiAssistEnabled"),
      undefined,
      { enabled: true },
    );

    if (isLocalWorkspace) {
      if (!embeddingModelStatus?.installed) {
        setProjectError(t("aiAssist.home.messages.downloadModelBeforeProjectEmbeddings"));
      } else if (!indexStatus?.exists) {
        setProjectNotice(t("aiAssist.home.messages.runProjectEmbeddingsToFinish"));
      }
      return;
    }

    if (remoteEmbeddingModelInstalled === false) {
      setProjectError(t("aiAssist.home.messages.hostNeedsModelBeforeProjectSetup"));
    } else if (remoteEmbeddingsReady === false) {
      setProjectNotice(t("aiAssist.home.messages.runProjectEmbeddingsToFinish"));
    }
  }

  async function handleDeleteAiAssistEmbeddings() {
    if (!activeProject || !canDeleteProjectEmbeddings) return;
    setAiAssistDeletingIndex(true);
    setProjectError("");
    setProjectNotice("");
    try {
      await invoke<ProjectEmbeddingStoreStatus>("delete_project_embedding_store", {
        authToken: pb.authStore.token,
        projectId: activeProject.id,
      });
      await updateProjectAiAssistSettings(activeProject.id, {
        ...projectAiAssistSettings,
        enabled: false,
      });
      await logAction(
        activeProject.id,
        "project.ai_assist.embeddings.delete",
        t("projectLog.labels.projectAiAssistEmbeddingsDeleted"),
      );
      setProjectNotice(t("aiAssist.home.messages.deletedProjectEmbeddings"));
    } catch (error) {
      console.error("Failed to delete project embeddings:", error);
      setProjectError(error instanceof Error ? error.message : t("aiAssist.home.messages.couldNotDeleteProjectEmbeddings"));
    } finally {
      setAiAssistDeletingIndex(false);
    }
  }

  function handleSetupShortcutTabSelect(nextTab: "device" | "project") {
    setSetupTab(nextTab);
  }

  if (!activeProject) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>{t("aiAssist.title")}</h1>
        </header>
        <div className="empty-state">
          <p>{t("aiAssist.home.empty.openProjectFirst")}</p>
        </div>
      </div>
    );
  }

  if (!canViewAiAssistHome) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>{t("aiAssist.title")}</h1>
        </header>
        <div className="empty-state">
          <p>{t("aiAssist.home.empty.noPermission")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="view home-view ai-assist-home-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>{t("aiAssist.title")}</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            aria-label={t("aiAssist.home.openHelp")}
            title={t("aiAssist.home.showHelp")}
            onClick={() => setHelpOpen(true)}
          >
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
      </header>

      <div className="ai-assist-home-layout">
        <div className="ai-assist-home-info-column">
          <section
            className={`home-project-card ai-assist-home-card ai-assist-home-status-card${setupTab === "device" ? " ai-assist-home-status-card--active" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => handleSetupShortcutTabSelect("device")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleSetupShortcutTabSelect("device");
              }
            }}
          >
            <div className="home-project-card-header">
              <div>
                <h2>{t("aiAssist.home.runtimeStatusTitle")}</h2>
                <p className="ai-assist-card-subcopy">
                  {t("aiAssist.home.runtimeStatusBody")}
                </p>
              </div>
            </div>
            <div className="home-restricted-list">
              <div className="home-restricted-item">
                <span className="home-restricted-label">{t("aiAssist.home.labels.embeddingModel")}</span>
                <span className={`home-restricted-value${(isLocalWorkspace ? embeddingModelStatus?.installed : remoteEmbeddingModelInstalled) ? " home-restricted-value--ready" : " home-restricted-value--pending"}`}>
                  {isLocalWorkspace
                    ? (embeddingModelStatus?.installed ? t("aiAssist.home.statuses.ready") : t("aiAssist.home.statuses.missing"))
                    : remoteEmbeddingModelInstalled == null
                      ? t("aiAssist.home.statuses.checking")
                      : remoteEmbeddingModelInstalled
                        ? t("aiAssist.home.statuses.ready")
                        : t("aiAssist.home.statuses.missing")}
                </span>
              </div>
              <div className="home-restricted-item">
                <span className="home-restricted-label">{isLocalWorkspace ? t("aiAssist.home.labels.llmConnection") : t("aiAssist.home.labels.hostLlm")}</span>
                <span className={`home-restricted-value${llmConnectionMode === "none" ? " home-restricted-value--pending" : " home-restricted-value--ready"}`}>
                  {runtimeConnectionModeLabel}
                </span>
              </div>
              <div className="home-restricted-item">
                <span className="home-restricted-label">{t("aiAssist.home.labels.selectedModel")}</span>
                <span className={`home-restricted-value${activeSelectedModel ? " home-restricted-value--ready" : " home-restricted-value--pending"}`}>
                  {isLocalWorkspace
                    ? (activeSelectedModel || t("aiAssist.home.statuses.noneSelected"))
                    : projectAiAssistRuntimeStatus.hostLlmModelSelected == null
                      ? t("aiAssist.home.statuses.checking")
                      : projectAiAssistRuntimeStatus.hostLlmModelSelected
                        ? t("aiAssist.home.statuses.selectedOnHost")
                        : t("aiAssist.home.statuses.noneSelected")}
                </span>
              </div>
            </div>
          </section>

          <section
            className={`home-project-card ai-assist-home-card ai-assist-home-status-card${setupTab === "project" ? " ai-assist-home-status-card--active" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => handleSetupShortcutTabSelect("project")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleSetupShortcutTabSelect("project");
              }
            }}
          >
            <div className="home-project-card-header">
              <div>
                    <h2>{t("aiAssist.home.projectReadinessTitle")}</h2>
                    <p className="ai-assist-card-subcopy">
                  {t("aiAssist.home.projectReadinessBody")}
                </p>
              </div>
            </div>
            <div className="home-restricted-list">
              <div className="home-restricted-item">
                <span className="home-restricted-label">{t("aiAssist.home.labels.aiAssistEnabled")}</span>
                <span className={`home-restricted-value${projectAiAssistSettings.enabled ? " home-restricted-value--ready" : " home-restricted-value--pending"}`}>
                  {projectAiAssistSettings.enabled ? t("aiAssist.home.statuses.enabled") : t("aiAssist.home.statuses.disabled")}
                </span>
              </div>
              <div className="home-restricted-item">
                <span className="home-restricted-label">{t("aiAssist.home.labels.embeddings")}</span>
                <span className={`home-restricted-value${indexStatus?.exists ? " home-restricted-value--ready" : " home-restricted-value--pending"}`}>
                  {embeddingStatusLabel}
                </span>
              </div>
              <div className="home-restricted-item">
                <span className="home-restricted-label">{t("aiAssist.home.labels.lastRun")}</span>
                <span className="home-restricted-value">{embeddingLastRunLabel}</span>
              </div>
              <div className="home-restricted-item">
                <span className="home-restricted-label">{t("aiAssist.home.labels.rerunNeeded")}</span>
                <span className={`home-restricted-value${projectEmbeddingNeedsRerun ? " home-restricted-value--pending" : " home-restricted-value--ready"}`}>
                  {projectEmbeddingRerunLabel}
                </span>
              </div>
            </div>
          </section>
        </div>

        <div className="ai-assist-home-actions-column">
          <div className="ai-assist-home-tabbar">
            <div className="segmented-control" role="tablist" aria-label={t("aiAssist.home.labels.setupViews")}>
              <button
                type="button"
                role="tab"
                aria-selected={setupTab === "device"}
                className={setupTab === "device" ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                onClick={() => setSetupTab("device")}
              >
                {t("aiAssist.home.labels.deviceLevel")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={setupTab === "project"}
                className={setupTab === "project" ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                onClick={() => setSetupTab("project")}
              >
                {t("aiAssist.home.labels.projectLevel")}
              </button>
            </div>
          </div>

          {setupTab === "device" ? (
            <section className="ai-assist-home-action-group">
              {!isLocalWorkspace ? (
                <section className="home-project-card ai-assist-home-card">
                  <div className="home-project-card-header">
                    <div>
                      <h2>{t("aiAssist.home.labels.hostRuntime")}</h2>
                      <p className="ai-assist-card-subcopy">
                        {t("aiAssist.home.labels.hostRuntimeBody")}
                      </p>
                    </div>
                  </div>
                  <div className="home-restricted-list">
                    <div className="home-restricted-item">
                      <span className="home-restricted-label">{t("aiAssist.home.labels.embeddingModel")}</span>
                      <span className={`home-restricted-value${remoteEmbeddingModelInstalled ? " home-restricted-value--ready" : " home-restricted-value--pending"}`}>
                        {remoteEmbeddingModelInstalled == null ? t("aiAssist.home.statuses.checking") : remoteEmbeddingModelInstalled ? t("aiAssist.home.statuses.ready") : t("aiAssist.home.statuses.missing")}
                      </span>
                    </div>
                    <div className="home-restricted-item">
                      <span className="home-restricted-label">{t("aiAssist.home.labels.hostLlm")}</span>
                      <span className={`home-restricted-value${llmConnectionStatus === "live" ? " home-restricted-value--ready" : " home-restricted-value--pending"}`}>
                        {llmConnectionStatus === "checking" ? t("aiAssist.home.statuses.checking") : llmConnectionStatus === "live" ? t("aiAssist.home.statuses.connected") : t("aiAssist.home.statuses.notReady")}
                      </span>
                    </div>
                  </div>
                </section>
              ) : (
                <>
                  <div className="ai-assist-home-card-row">
                  <section className="home-project-card ai-assist-home-card ai-assist-home-card--balanced">
                    <div className="home-project-card-header">
                      <div>
                        <h2>{t("aiAssist.home.labels.aiRuntime")}</h2>
                        <p className="ai-assist-card-subcopy">
                          {t("aiAssist.home.labels.aiRuntimeBody")}
                        </p>
                      </div>
                    </div>
                    {deviceError && <div className="form-error project-settings-error">{deviceError}</div>}
                    {deviceNotice && <div className="settings-success project-settings-success">{deviceNotice}</div>}
                    <div className="project-model-card">
                      <div>
                        <div className="project-model-name">{embeddingModelStatus?.displayName ?? "multilingual-e5-large"}</div>
                        <p className="project-model-description">
                          {t("aiAssist.home.labels.status")}: {embeddingRuntimeStatusLabel}
                        </p>
                        <p className="project-model-description">
                          {t("aiAssist.home.labels.size")}: {embeddingModelStatus?.bytes ? formatBytes(embeddingModelStatus.bytes) : t("aiAssist.home.statuses.notAvailableYet")}
                        </p>
                        <p className="project-model-description">
                          {t("aiAssist.home.labels.files")}: {embeddingModelStatus?.files ? t("aiAssist.home.labels.filesCount", { count: embeddingModelStatus.files }) : t("aiAssist.home.statuses.notAvailableYet")}
                        </p>
                      </div>
                    </div>
                    <div className="project-export-actions project-export-actions--modal">
                      {!embeddingModelInstalled && !embeddingDownloadActive ? (
                        <button
                          className="btn btn--primary"
                          type="button"
                          onClick={() => void handleEmbeddingModelDownload()}
                          disabled={projectBuildBusy || !canDownloadEmbeddingModel}
                        >
                          {projectBuildBusy ? t("aiAssist.home.statuses.busy") : t("aiAssist.home.actions.download")}
                        </button>
                      ) : null}
                      {embeddingDownloadActive ? (
                        <button
                          className="btn"
                          type="button"
                          onClick={() => void handleEmbeddingModelCancel()}
                          disabled={!canDownloadEmbeddingModel}
                        >
                          {embeddingDownloadPhase === "cancelling" ? t("aiAssist.home.statuses.cancellingAction") : t("aiAssist.home.actions.cancel")}
                        </button>
                      ) : null}
                      {embeddingModelInstalled && !embeddingDownloadActive ? (
                        <>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => setActiveDeviceModal("download-details")}
                          >
                            {t("aiAssist.home.actions.details")}
                          </button>
                          <button
                            className="btn btn--primary"
                            type="button"
                            onClick={() => void handleEmbeddingModelClear()}
                            disabled={
                              !canDeleteEmbeddingModel ||
                              (!embeddingModelStatus?.installed && !(embeddingModelStatus?.files && embeddingModelStatus.files > 0))
                            }
                            style={{ marginLeft: "auto" }}
                          >
                            {t("aiAssist.home.actions.clear")}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </section>

                  <section className={`home-project-card ai-assist-home-card ai-assist-home-card--balanced${embeddingTuningAvailable ? "" : " ai-assist-home-card--disabled"}`}>
                    <div className="home-project-card-header">
                      <div>
                        <h2>{t("aiAssist.home.labels.embeddingTuning")}</h2>
                        <p className="ai-assist-card-subcopy">
                          {t("aiAssist.home.labels.embeddingTuningBody")}
                        </p>
                      </div>
                    </div>
                    <div className="project-model-card">
                      <div>
                        <div className="project-model-name">{t("aiAssist.home.labels.defaults")}</div>
                        <p className="project-model-description">
                          {t("aiAssist.home.labels.chunkSize")}: {appSettings.llm.chunkSize}
                        </p>
                        <p className="project-model-description">
                          {t("aiAssist.home.labels.overlap")}: {appSettings.llm.overlapSize}
                        </p>
                        <p className="project-model-description">
                          {t("aiAssist.home.labels.batchSize")}: {appSettings.llm.batchSize}
                        </p>
                      </div>
                    </div>
                    {!embeddingTuningAvailable ? (
                      <div className="users-permission-note ai-assist-home-disabled-note">
                        {embeddingTuningBlockedMessage}
                      </div>
                    ) : null}
                    <div className="project-export-actions project-export-actions--modal">
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setActiveDeviceModal("embedding-tuning")}
                        disabled={!embeddingTuningAvailable}
                        title={embeddingTuningAvailable ? undefined : embeddingTuningBlockedMessage}
                      >
                        {t("aiAssist.home.actions.tuning")}
                      </button>
                    </div>
                  </section>

                  <section className="home-project-card ai-assist-home-card ai-assist-home-card--balanced">
                    <div className="home-project-card-header">
                      <div>
                        <h2>{t("aiAssist.home.labels.llmConnection")}</h2>
                        <p className="ai-assist-card-subcopy">
                          {t("aiAssist.home.messages.llmConnectionBody")}
                        </p>
                        <div className="settings-toggle-row settings-toggle-row--stacked settings-toggle-row--compact">
                          <div
                            className="segmented-control ai-assist-connection-mode-toggle"
                            role="tablist"
                            aria-label={t("aiAssist.home.labels.connectionMode")}
                          >
                            <button
                              type="button"
                              role="tab"
                              aria-selected={llmConnectionMode === "none"}
                              className={
                                llmConnectionMode === "none"
                                  ? "segmented-control-option segmented-control-option--active"
                                  : "segmented-control-option"
                              }
                              disabled={!canManageLlmSettings}
                              onClick={() => handleLlmConnectionModeChange("none")}
                            >
                              {t("aiAssist.home.statuses.none")}
                            </button>
                            <button
                              type="button"
                              role="tab"
                              aria-selected={llmConnectionMode === "local"}
                              className={
                                llmConnectionMode === "local"
                                  ? "segmented-control-option segmented-control-option--active"
                                  : "segmented-control-option"
                              }
                              disabled={!canManageLlmSettings}
                              onClick={() => handleLlmConnectionModeChange("local")}
                            >
                              {t("aiAssist.home.statuses.local")}
                            </button>
                            <button
                              type="button"
                              role="tab"
                              aria-selected={llmConnectionMode === "cloud"}
                              className={
                                llmConnectionMode === "cloud"
                                  ? "segmented-control-option segmented-control-option--active"
                                  : "segmented-control-option"
                              }
                              disabled={!canManageLlmSettings}
                              onClick={() => handleLlmConnectionModeChange("cloud")}
                            >
                              {t("aiAssist.home.statuses.cloud")}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    {llmConnectionMode === "none" ? (
                      <div className="project-model-card">
                        <div>
                          <div className="project-model-name">{t("aiAssist.home.messages.llmConnectionsDisabled")}</div>
                          <p className="project-model-description">
                            {t("aiAssist.home.messages.noLlmProviderUntilEnabled")}
                          </p>
                        </div>
                      </div>
                    ) : null}
                    {llmConnectionMode === "local" ? (
                      <>
                        {ollamaError && <div className="form-error project-settings-error">{ollamaError}</div>}
                        <p className="ai-assist-inline-help">
                          {t("aiAssist.home.messages.localProviderBody")}
                        </p>
                        <div className={llmServerCardClassName}>
                          <div>
                            <div className="project-model-name">{t("aiAssist.home.labels.localLlmServer")}</div>
                            <p className="project-model-description">
                              {t("aiAssist.home.labels.endpoint")} <code>{appSettings.llm.ollamaProtocol}://{appSettings.llm.ollamaHost}:{appSettings.llm.ollamaPort}</code>
                            </p>
                            <p className="project-model-description">
                              {t("aiAssist.home.labels.status")} {ollamaDiscovery?.ok ? t("aiAssist.home.statuses.connected") : t("aiAssist.home.statuses.notTestedYet")}
                            </p>
                            <p className="project-model-description">
                              {t("aiAssist.home.labels.version")} {ollamaDiscovery?.version || t("aiAssist.home.statuses.notAvailable")}
                            </p>
                            <p className="project-model-description">
                              {t("aiAssist.home.labels.models")} {ollamaDiscovery?.ok
                                ? t("aiAssist.home.messages.modelsFound", { count: ollamaDiscovery.modelCount })
                                : t("aiAssist.home.messages.notLoaded")}
                            </p>
                          </div>
                        </div>
                        <div className="project-export-actions project-export-actions--modal llm-connection-actions llm-connection-actions--inline">
                          <button type="button" className="btn" onClick={() => setActiveDeviceModal("connection-settings")}>
                            Settings
                          </button>
                          <button
                            className="btn btn--primary"
                            type="button"
                            onClick={() => void handleOllamaTestConnection()}
                            disabled={ollamaBusy || !canManageLlmSettings}
                            style={{ marginLeft: "auto" }}
                          >
                            {ollamaBusy ? t("aiAssist.home.statuses.testing") : t("aiAssist.home.actions.test")}
                          </button>
                        </div>
                      </>
                    ) : null}
                    {llmConnectionMode === "cloud" ? (
                      <>
                        {cloudError && <div className="form-error project-settings-error">{cloudError}</div>}
                        {cloudNotice && <div className="settings-success project-settings-success">{cloudNotice}</div>}
                        <fieldset className="llm-settings-grid llm-settings-grid--single" disabled={!canManageLlmSettings} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
                          <label className="form-label">
                            {t("aiAssist.home.labels.apiProvider")}
                            <span className="settings-field-hint">{t("aiAssist.home.messages.chooseCloudService")}</span>
                            <select
                              className="form-input"
                              value={appSettings.llm.cloudProvider}
                              onChange={(e) => handleCloudProviderChange(e.target.value as CloudLlmProvider)}
                            >
                              {CLOUD_PROVIDER_OPTIONS.map((provider) => (
                                <option key={provider.value} value={provider.value}>
                                  {provider.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <p className="ai-assist-inline-help">
                            {selectedCloudProvider.helpText}{" "}
                            <a
                              href={selectedCloudProvider.keyUrl}
                              onClick={(event) => {
                                event.preventDefault();
                                void openUrl(selectedCloudProvider.keyUrl);
                              }}
                            >
                              {t("aiAssist.home.actions.openKeySetup")}
                            </a>
                          </p>
                          <div className={cloudProviderCardClassName}>
                            <div>
                              <div className="project-model-name">{selectedCloudProvider.label} {t("aiAssist.home.labels.endpointNoun")}</div>
                              <p className="project-model-description">
                                {t("aiAssist.home.labels.status")} {cloudDiscovery?.ok
                                  ? t("aiAssist.home.statuses.connected")
                                  : cloudBusy
                                    ? t("aiAssist.home.statuses.testing")
                                    : t("aiAssist.home.statuses.notTestedYet")}
                              </p>
                              <p className="project-model-description">
                                {t("aiAssist.home.labels.endpoint")} <code>{cloudDiscovery?.baseUrl || (
                                  selectedCloudProvider.value === "openai"
                                    ? "https://api.openai.com/v1"
                                    : selectedCloudProvider.value === "anthropic"
                                      ? "https://api.anthropic.com/v1"
                                      : selectedCloudProvider.value === "copilot"
                                        ? "https://models.github.ai"
                                        : selectedCloudProvider.value === "blablador"
                                          ? "https://api.blablador.fz-juelich.de/v1"
                                          : "https://ollama.com/api"
                                )}</code>
                              </p>
                              <p className="project-model-description">
                                {t("aiAssist.home.labels.models")} {cloudDiscovery?.ok
                                  ? t("aiAssist.home.messages.modelsAvailable", { count: cloudDiscovery.modelCount })
                                  : t("aiAssist.home.messages.loadAfterSuccessfulTest")}
                              </p>
                            </div>
                          </div>
                          <label className="form-label">
                            API secret
                            <span className="settings-field-hint">{t("aiAssist.home.messages.pasteProviderKey")}</span>
                            <input
                              className="form-input"
                              type="password"
                              autoComplete="off"
                              value={appSettings.llm.cloudApiSecret}
                              onChange={(e) => handleCloudSecretChange(e.target.value)}
                              placeholder={t("aiAssist.home.labels.cloudSecretPlaceholder", {
                                provider: selectedCloudProvider.label,
                              })}
                            />
                          </label>
                        </fieldset>
                        <div className="project-export-actions project-export-actions--modal llm-connection-actions llm-connection-actions--inline">
                          <button
                            className="btn btn--primary"
                            type="button"
                            onClick={() => void handleCloudTestConnection()}
                            disabled={!canManageLlmSettings || cloudBusy}
                            style={{ marginLeft: "auto" }}
                          >
                            {cloudBusy ? t("aiAssist.home.statuses.testing") : t("aiAssist.home.actions.test")}
                          </button>
                        </div>
                      </>
                    ) : null}
                  </section>

                  <section className={`home-project-card ai-assist-home-card${generationDefaultsAvailable ? "" : " ai-assist-home-card--disabled"}`}>
                    <div className="home-project-card-header">
                      <div>
                        <h2>{t("aiAssist.home.labels.generationDefaults")}</h2>
                        <p className="ai-assist-card-subcopy">
                          {t("aiAssist.home.messages.generationDefaultsBody")}
                        </p>
                      </div>
                    </div>
                    <fieldset className="llm-settings-grid llm-settings-grid--single" disabled={!canManageLlmSettings || !generationDefaultsAvailable} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
                      <label className="form-label">
                        {llmConnectionMode === "cloud"
                          ? t("aiAssist.home.labels.availableCloudModel")
                          : t("aiAssist.home.labels.availableLocalModel")}
                        <span className="settings-field-hint">
                          {llmConnectionMode === "cloud"
                            ? t("aiAssist.home.messages.testCloudConnectionFirst")
                            : t("aiAssist.home.messages.testLocalConnectionFirst")}
                        </span>
                        <select
                          className="form-input"
                          value={llmConnectionMode === "cloud" ? appSettings.llm.cloudSelectedModel : appSettings.llm.ollamaSelectedModel}
                          onChange={(e) => persistAppSettings({
                            ...appSettings,
                            llm: {
                              ...appSettings.llm,
                              ...(llmConnectionMode === "cloud"
                                ? { cloudSelectedModel: e.target.value }
                                : { ollamaSelectedModel: e.target.value }),
                            },
                          })}
                          disabled={generationModelOptions.length === 0}
                        >
                          <option value="">
                            {llmConnectionMode === "cloud"
                              ? (generationModelOptions.length === 0
                                ? t("aiAssist.home.messages.noCloudModelsLoadedYet")
                                : t("aiAssist.home.labels.selectModel"))
                              : (generationModelOptions.length === 0
                                ? t("aiAssist.home.messages.noModelsLoadedYet")
                                : t("aiAssist.home.labels.selectModel"))}
                          </option>
                          {generationModelOptions.map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </fieldset>
                    {!generationDefaultsAvailable ? (
                      <div className="users-permission-note ai-assist-home-disabled-note">
                        {generationDefaultsBlockedMessage}
                      </div>
                    ) : null}
                    <div className="project-export-actions project-export-actions--modal">
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setActiveDeviceModal("generation-defaults")}
                        disabled={!generationDefaultsAvailable}
                        title={generationDefaultsAvailable ? undefined : generationDefaultsBlockedMessage}
                      >
                        {t("aiAssist.home.labels.defaults")}
                      </button>
                    </div>
                  </section>
                </div>
                </>
              )}
            </section>
          ) : (
            <section className="ai-assist-home-action-group">
              <div className="ai-assist-home-card-row ai-assist-home-card-row--project">
                <section className="home-project-card ai-assist-home-card">
                  <div className="home-project-card-header">
                    <div>
                      <h2>{t("aiAssist.home.projectAiAssistTitle")}</h2>
                      <p className="ai-assist-card-subcopy">
                        {t("aiAssist.home.messages.projectAiAssistBody")}
                      </p>
                    </div>
                  </div>
                  {(projectError || projectBuildError) && (
                    <div className="form-error project-settings-error">{projectError || projectBuildError}</div>
                  )}
                  {projectNotice && <div className="settings-success project-settings-success">{projectNotice}</div>}
                  <label className="settings-toggle-row">
                    <span>
                      <strong>{t("aiAssist.home.actions.enable")}</strong>
                    </span>
                    <input
                      type="checkbox"
                      checked={projectAiAssistSettings.enabled}
                      disabled={!canEnableProjectAiAssist}
                      onChange={(event) => void handleProjectAiAssistEnabledChange(event.target.checked)}
                    />
                  </label>
                </section>

                <section className="home-project-card ai-assist-home-card">
                  <div className="home-project-card-header">
                    <div>
                      <h2>{t("aiAssist.home.embeddingManagementTitle")}</h2>
                      <p className="ai-assist-card-subcopy">
                        {t("aiAssist.home.messages.embeddingManagementBody")}
                      </p>
                    </div>
                  </div>
                  <div className="form-actions" style={{ marginTop: 16, justifyContent: "flex-start" }}>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setBuildModalOpen(true)}
                      disabled={projectBuildBusy || !canBuildProjectEmbeddings}
                      title={canBuildProjectEmbeddings ? undefined : t("aiAssist.home.messages.noPermissionToBuildProjectEmbeddings")}
                    >
                      {projectBuildPhase === "running"
                        ? t("aiAssist.home.statuses.building")
                        : indexStatus?.exists
                          ? t("aiAssist.home.actions.rebuild")
                          : t("aiAssist.home.actions.run")}
                    </button>
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={() => void handleDeleteAiAssistEmbeddings()}
                      disabled={projectBuildBusy || aiAssistDeletingIndex || !indexStatus?.exists || !canDeleteProjectEmbeddings}
                      style={{ marginLeft: "auto" }}
                      title={
                        !canDeleteProjectEmbeddings
                          ? t("aiAssist.home.messages.noPermissionToDeleteProjectEmbeddings")
                          : !indexStatus?.exists
                            ? t("aiAssist.home.messages.noProjectEmbeddingsToDelete")
                            : undefined
                      }
                    >
                      {aiAssistDeletingIndex ? t("aiAssist.home.statuses.deleting") : t("aiAssist.home.actions.delete")}
                    </button>
                  </div>
                  {!canBuildProjectEmbeddings && !canDeleteProjectEmbeddings && (
                    <div className="users-permission-note">
                      {t("aiAssist.home.messages.viewOnlyProjectEmbeddingStatus")}
                    </div>
                  )}
                </section>
              </div>
            </section>
          )}
        </div>
      </div>

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal modal--help" onClick={(e) => e.stopPropagation()}>
            <h2>{t("aiAssist.home.help.title")}</h2>
            <p className="users-guide-copy">
              {t("aiAssist.home.help.line1")}
            </p>
            <p className="users-guide-copy">
              {t("aiAssist.home.help.line2")}
            </p>
            <p className="users-guide-copy">
              {t("aiAssist.home.help.line3")}
            </p>
            <div className="form-actions">
              <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      )}

      <DeviceDetailsModal
        open={activeDeviceModal === "download-details"}
        title={t("aiAssist.home.modals.embeddingDownloadDetails")}
        onClose={() => setActiveDeviceModal(null)}
      >
        <ul className="ai-assist-settings-summary-list">
          <li>
            <strong>{t("aiAssist.home.labels.repository")}</strong> <code>{embeddingModelStatus?.repoId ?? "intfloat/multilingual-e5-large"}</code>
          </li>
          <li>
            <strong>{t("aiAssist.home.labels.totalDownload")}</strong> {formatBytes(embeddingModelPreflight?.totalBytes ?? 0)}
          </li>
          <li>
            <strong>{t("aiAssist.home.labels.alreadyOnDevice")}</strong> {formatBytes(embeddingModelPreflight?.existingBytes ?? embeddingModelStatus?.bytes ?? 0)}
            {embeddingModelPreflight?.manifestAvailable ? ` | ${embeddingModelPreflight?.existingFiles ?? 0} files` : ""}
          </li>
          <li>
            <strong>{t("aiAssist.home.labels.remaining")}</strong> {formatBytes(embeddingModelPreflight?.remainingBytes ?? 0)}
            {embeddingModelPreflight?.manifestAvailable && embeddingModelPreflight?.remainingFiles != null
              ? ` ${t("aiAssist.home.messages.remainingFilesAcross", { count: embeddingModelPreflight.remainingFiles })}`
              : ""}
          </li>
          <li>
            <strong>{t("aiAssist.home.labels.downloadedAt")}</strong> {formatDownloadDate(embeddingModelStatus?.downloadedAtMs, t("aiAssist.home.labels.notDownloadedYet"))}
          </li>
          <li>
            <strong>{t("aiAssist.home.labels.location")}</strong> <code>{embeddingModelStatus?.modelDir ?? t("aiAssist.home.messages.detectingLocalModelDirectory")}</code>
          </li>
        </ul>
      </DeviceDetailsModal>

      <DeviceDetailsModal
        open={activeDeviceModal === "embedding-tuning"}
        title={t("aiAssist.home.modals.embeddingTuning")}
        onClose={() => setActiveDeviceModal(null)}
      >
        <div className="llm-settings-grid">
          <label className="form-label">
            {t("aiAssist.home.labels.chunkSize")}
            <span className="settings-field-hint">{t("aiAssist.home.messages.chunkSizeHint")}</span>
            <input
              className="form-input"
              type="number"
              min={100}
              max={20000}
              value={appSettings.llm.chunkSize}
              onChange={(e) => {
                const chunkSize = clampInteger(Number(e.target.value), 100, 20000);
                const overlapSize = Math.min(appSettings.llm.overlapSize, Math.max(0, chunkSize - 1));
                persistAppSettings({
                  ...appSettings,
                  llm: {
                    ...appSettings.llm,
                    chunkSize,
                    overlapSize,
                  },
                });
              }}
            />
          </label>
          <label className="form-label">
            {t("aiAssist.home.labels.overlapSize")}
            <span className="settings-field-hint">{t("aiAssist.home.messages.overlapSizeHint")}</span>
            <input
              className="form-input"
              type="number"
              min={0}
              max={Math.max(0, appSettings.llm.chunkSize - 1)}
              value={appSettings.llm.overlapSize}
              onChange={(e) => persistAppSettings({
                ...appSettings,
                llm: {
                  ...appSettings.llm,
                  overlapSize: clampInteger(Number(e.target.value), 0, Math.max(0, appSettings.llm.chunkSize - 1)),
                },
              })}
            />
          </label>
          <label className="form-label">
            {t("aiAssist.home.labels.batchSize")}
            <span className="settings-field-hint">{t("aiAssist.home.messages.batchSizeHint")}</span>
            <input
              className="form-input"
              type="number"
              min={1}
              max={256}
              value={appSettings.llm.batchSize}
              onChange={(e) => persistAppSettings({
                ...appSettings,
                llm: {
                  ...appSettings.llm,
                  batchSize: clampInteger(Number(e.target.value), 1, 256),
                },
              })}
            />
          </label>
        </div>
      </DeviceDetailsModal>

      <DeviceDetailsModal
        open={activeDeviceModal === "connection-settings"}
        title={t("aiAssist.home.modals.connectionSettings")}
        onClose={() => setActiveDeviceModal(null)}
      >
        <fieldset className="llm-settings-grid" disabled={!canManageLlmSettings} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          <label className="form-label">
            {t("aiAssist.home.labels.protocol")}
            <span className="settings-field-hint">{t("aiAssist.home.messages.protocolHint")}</span>
            <select
              className="form-input"
              value={appSettings.llm.ollamaProtocol}
              onChange={(e) => persistAppSettings({
                ...appSettings,
                llm: {
                  ...appSettings.llm,
                  ollamaProtocol: e.target.value === "https" ? "https" : "http",
                },
              })}
            >
              <option value="http">http</option>
              <option value="https">https</option>
            </select>
          </label>
          <label className="form-label">
            {t("aiAssist.home.labels.hostUrl")}
            <span className="settings-field-hint">{t("aiAssist.home.messages.hostUrlHint")}</span>
            <input
              className="form-input"
              type="text"
              value={appSettings.llm.ollamaHost}
              onChange={(e) => persistAppSettings({
                ...appSettings,
                llm: { ...appSettings.llm, ollamaHost: e.target.value },
              })}
            />
          </label>
          <label className="form-label">
            {t("aiAssist.home.labels.port")}
            <span className="settings-field-hint">{t("aiAssist.home.messages.portHint")}</span>
            <input
              className="form-input"
              type="number"
              min={1}
              max={65535}
              value={appSettings.llm.ollamaPort}
              onChange={(e) => persistAppSettings({
                ...appSettings,
                llm: {
                  ...appSettings.llm,
                  ollamaPort: clampInteger(Number(e.target.value), 1, 65535),
                },
              })}
            />
          </label>
          <label className="form-label">
            {t("aiAssist.home.labels.requestTimeout")}
            <span className="settings-field-hint">{t("aiAssist.home.messages.requestTimeoutHint")}</span>
            <input
              className="form-input"
              type="number"
              min={5}
              max={600}
              value={appSettings.llm.ollamaRequestTimeoutSeconds}
              onChange={(e) => persistAppSettings({
                ...appSettings,
                llm: {
                  ...appSettings.llm,
                  ollamaRequestTimeoutSeconds: clampInteger(Number(e.target.value), 5, 600),
                },
              })}
            />
          </label>
        </fieldset>
      </DeviceDetailsModal>

      <DeviceDetailsModal
        open={activeDeviceModal === "generation-defaults"}
        title={t("aiAssist.home.modals.generationDefaults")}
        onClose={() => setActiveDeviceModal(null)}
      >
        <fieldset className="llm-settings-grid" disabled={!canManageLlmSettings} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          <label className="form-label">
            {t("aiAssist.home.labels.temperature")}
            <span className="settings-field-hint">{t("aiAssist.home.messages.temperatureHint")}</span>
            <input
              className="form-input"
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={appSettings.llm.ollamaTemperature}
              onChange={(e) => persistAppSettings({
                ...appSettings,
                llm: {
                  ...appSettings.llm,
                  ollamaTemperature: Math.max(0, Math.min(2, Number(e.target.value) || 0)),
                },
              })}
            />
          </label>
          <label className="form-label">
            {t("aiAssist.home.labels.contextWindow")}
            <span className="settings-field-hint">{t("aiAssist.home.messages.contextWindowHint")}</span>
            <input
              className="form-input"
              type="number"
              min={256}
              max={131072}
              value={appSettings.llm.ollamaNumCtx}
              onChange={(e) => persistAppSettings({
                ...appSettings,
                llm: {
                  ...appSettings.llm,
                  ollamaNumCtx: clampInteger(Number(e.target.value), 256, 131072),
                },
              })}
            />
          </label>
          <label className="form-label">
            {t("aiAssist.home.labels.keepAliveMinutes")}
            <span className="settings-field-hint">{t("aiAssist.home.messages.keepAliveHint")}</span>
            <input
              className="form-input"
              type="number"
              min={0}
              max={1440}
              value={appSettings.llm.ollamaKeepAliveMinutes}
              onChange={(e) => persistAppSettings({
                ...appSettings,
                llm: {
                  ...appSettings.llm,
                  ollamaKeepAliveMinutes: clampInteger(Number(e.target.value), 0, 1440),
                },
              })}
            />
          </label>
          <label className="form-label">
            {t("aiAssist.home.labels.relevantSegmentShortlist")}
            <span className="settings-field-hint">{t("aiAssist.home.messages.relevantSegmentShortlistHint")}</span>
            <input
              className="form-input"
              type="number"
              min={1}
              max={50}
              value={appSettings.llm.ollamaRelevantSegmentsCandidateLimit}
              onChange={(e) => {
                const candidateLimit = clampInteger(Number(e.target.value), 1, 50);
                persistAppSettings({
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
            {t("aiAssist.home.labels.relevantSegmentsReturned")}
            <span className="settings-field-hint">{t("aiAssist.home.messages.relevantSegmentsReturnedHint")}</span>
            <input
              className="form-input"
              type="number"
              min={1}
              max={appSettings.llm.ollamaRelevantSegmentsCandidateLimit}
              value={appSettings.llm.ollamaRelevantSegmentsMaxResults}
              onChange={(e) => persistAppSettings({
                ...appSettings,
                llm: {
                  ...appSettings.llm,
                  ollamaRelevantSegmentsMaxResults: clampInteger(
                    Number(e.target.value),
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
        buildModalOpen={buildModalOpen}
        hasExistingIndex={!!indexStatus?.exists}
        onClose={() => setBuildModalOpen(false)}
        onRun={() => {
          void handleRunEmbedding().then((started) => {
            if (started) {
              setProjectNotice(t("aiAssist.home.messages.projectEmbeddingsPreparing"));
              setBuildModalOpen(false);
            }
          });
        }}
      />
    </div>
  );
}
