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

function formatDownloadDate(value: number | null | undefined): string {
  if (!value) return "Not downloaded yet";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "Not downloaded yet";
  }
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function useEmbeddingRunState() {
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
        if (!cancelled) setError("Could not load the latest embedding run details.");
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
  ]);

  async function handleRunEmbedding() {
    if (!activeProject) return false;
    setError("");

    try {
      if (isLocalWorkspace) {
        const latestModelStatus = await invoke<EmbeddingModelStatus>("get_multilingual_e5_status");
        if (!latestModelStatus.installed) {
          setError("Download the multilingual-e5 model in Device-Level Setup before building embeddings.");
          return false;
        }

        const llmSettings = readAppSettings().llm;
        const sources = buildProjectEmbeddingSources(documents, cases, codes, annotations, memos, llmSettings);
        if (sources.length === 0) {
          setError("There is no project content available to embed yet.");
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
          setError("The host device still needs the multilingual-e5 model before it can build project embeddings.");
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
      setError(nextError instanceof Error ? nextError.message : "Could not rerun project embeddings.");
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
              {hasExistingIndex ? "Rebuild Project Embeddings" : "Run Project Embeddings"}
            </h2>
            <p className="settings-section-desc">
              Kanqual is refreshing the multilingual-e5 index for this project.
            </p>
          </div>
        </div>
        <div className="app-settings-modal-body">
          <div className="project-model-modal-copy">
            <p>
              This is usually a first-run setup task, but you can rerun it any time the project
              changes enough that you want a fresh AI Assist index.
            </p>
          </div>
          <div className="form-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" onClick={onRun}>
              {hasExistingIndex ? "Re-run" : "Run"}
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
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AIAssistView() {
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
      ? "Downloading"
      : embeddingDownloadPhase === "cancelling"
        ? "Cancelling"
        : embeddingModelInstalled
          ? "Downloaded"
          : "None";
  const llmConnectionMode = appSettings.llm.connectionMode;
  const selectedCloudProvider = CLOUD_PROVIDER_OPTIONS.find(
    (provider) => provider.value === appSettings.llm.cloudProvider,
  ) ?? CLOUD_PROVIDER_OPTIONS[0];
  const activeSelectedModel =
    llmConnectionMode === "cloud" ? appSettings.llm.cloudSelectedModel : appSettings.llm.ollamaSelectedModel;
  const runtimeConnectionModeLabel = llmConnectionMode === "none"
    ? "None"
    : llmConnectionMode === "cloud"
      ? "Cloud"
      : "Local";
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
  const embeddingTuningBlockedMessage = "Download the embedding model first.";
  const generationDefaultsBlockedMessage = "Set up an LLM connection first.";

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
      ? "Building in background"
      : projectBuildPhase === "cancelling"
        ? "Cancelling build"
        : indexStatus?.exists
          ? "Generated"
          : "Not built";
  const embeddingLastRunLabel =
    projectBuildPhase === "running"
      ? "Running now"
      : projectBuildPhase === "cancelling"
        ? "Stopping current run"
        : indexStatus?.generatedAtMs
          ? new Date(indexStatus.generatedAtMs).toLocaleString()
          : "No run yet";
  const projectEmbeddingNeedsRerun =
    projectBuildPhase === "running" || projectBuildPhase === "cancelling"
      ? false
      : indexStatus?.exists
        ? indexStatus.itemCount !== currentProjectEmbeddingItemCount
        : true;
  const projectEmbeddingRerunLabel =
    projectBuildPhase === "running"
      ? "Updating now"
      : projectBuildPhase === "cancelling"
        ? "Stopping current run"
        : !indexStatus?.exists
          ? "Needs first run"
          : projectEmbeddingNeedsRerun
            ? "Re-run recommended"
            : "Up to date";
  const embeddingStatusDetail =
    indexStatus?.generatedAtMs
      ? `Last run ${new Date(indexStatus.generatedAtMs).toLocaleString()}`
      : isLocalWorkspace
        ? "No local project embeddings have been built yet."
        : "No host project embeddings have been built yet.";

  const refreshEmbeddingModelStatus = useCallback(() => {
    if (!isLocalWorkspace) return;
    invoke<EmbeddingModelStatus>("get_multilingual_e5_status")
      .then((status) => {
        setEmbeddingModelStatus(status);
      })
      .catch((error) => {
        console.error("Failed to load embedding model status:", error);
        setDeviceError("Could not load embedding model status.");
      });
  }, [isLocalWorkspace]);

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
      setDeviceNotice("Embedding model download started in the background.");
    } catch (error) {
      console.error("Embedding model download failed:", error);
      setDeviceError(error instanceof Error ? error.message : "Embedding model download failed. Please try again.");
    }
  }

  async function handleEmbeddingModelCancel() {
    if (!canDownloadEmbeddingModel) return;
    setDeviceError("");
    setDeviceNotice("");
    try {
      const status = await cancelEmbeddingModelDownload();
      if (status.phase === "cancelling") {
        setDeviceNotice("Embedding model download is cancelling in the background.");
      }
    } catch (error) {
      console.error("Embedding model cancel failed:", error);
      setDeviceError(error instanceof Error ? error.message : "Could not cancel the embedding model download.");
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
      setDeviceNotice("Local multilingual-e5 files cleared.");
    } catch (error) {
      console.error("Embedding model clear failed:", error);
      setDeviceError(error instanceof Error ? error.message : "Could not clear local multilingual-e5 files.");
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
      setOllamaError(error instanceof Error ? error.message : "Could not connect to the configured LLM server.");
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
      setCloudError(error instanceof Error ? error.message : "Could not connect to the selected cloud provider.");
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
      await persistProjectAiAssist(false, "Project AI Assist disabled.");
      await logAction(activeProject.id, "project.ai_assist.update", "Disabled AI Assist for this project");
      return;
    }

    await persistProjectAiAssist(
      true,
      "Project AI Assist enabled. Finish the remaining setup steps below if this project is not ready yet.",
    );
    await logAction(activeProject.id, "project.ai_assist.update", "Enabled AI Assist for this project");

    if (isLocalWorkspace) {
      if (!embeddingModelStatus?.installed) {
        setProjectError("Download the multilingual-e5 model in Device-Level Setup before building project embeddings.");
      } else if (!indexStatus?.exists) {
        setProjectNotice("Project AI Assist is on. Run project embeddings below to finish setup.");
      }
      return;
    }

    if (remoteEmbeddingModelInstalled === false) {
      setProjectError("The host device still needs the multilingual-e5 model before project AI Assist can finish setup.");
    } else if (remoteEmbeddingsReady === false) {
      setProjectNotice("Project AI Assist is on. Run project embeddings below to finish setup.");
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
        "Deleted AI Assist embeddings and disabled AI Assist",
      );
      setProjectNotice("Deleted project embeddings. AI Assist has been turned off until embeddings are rebuilt.");
    } catch (error) {
      console.error("Failed to delete project embeddings:", error);
      setProjectError(error instanceof Error ? error.message : "Could not delete project embeddings.");
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
          <h1>AI Assist</h1>
        </header>
        <div className="empty-state">
          <p>Open a project first.</p>
        </div>
      </div>
    );
  }

  if (!canViewAiAssistHome) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>AI Assist</h1>
        </header>
        <div className="empty-state">
          <p>You do not have permission to view AI Assist for this project.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="view home-view ai-assist-home-view">
      <header className="view-header">
        <div className="users-title-wrap">
          <h1>AI Assist</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            aria-label="Show AI Assist help"
            title="Show Help"
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
                <h2>Runtime Status</h2>
                <p className="ai-assist-card-subcopy">
                  Check whether the runtime pieces AI Assist depends on are available right now.
                </p>
              </div>
            </div>
            <div className="home-restricted-list">
              <div className="home-restricted-item">
                <span className="home-restricted-label">Embedding model</span>
                <span className={`home-restricted-value${(isLocalWorkspace ? embeddingModelStatus?.installed : remoteEmbeddingModelInstalled) ? " home-restricted-value--ready" : " home-restricted-value--pending"}`}>
                  {isLocalWorkspace
                    ? (embeddingModelStatus?.installed ? "Ready" : "Missing")
                    : remoteEmbeddingModelInstalled == null
                      ? "Checking..."
                      : remoteEmbeddingModelInstalled
                        ? "Ready"
                        : "Missing"}
                </span>
              </div>
              <div className="home-restricted-item">
                <span className="home-restricted-label">{isLocalWorkspace ? "LLM connection" : "Host LLM"}</span>
                <span className={`home-restricted-value${llmConnectionMode === "none" ? " home-restricted-value--pending" : " home-restricted-value--ready"}`}>
                  {runtimeConnectionModeLabel}
                </span>
              </div>
              <div className="home-restricted-item">
                <span className="home-restricted-label">Selected model</span>
                <span className={`home-restricted-value${activeSelectedModel ? " home-restricted-value--ready" : " home-restricted-value--pending"}`}>
                  {isLocalWorkspace
                    ? (activeSelectedModel || "None selected")
                    : projectAiAssistRuntimeStatus.hostLlmModelSelected == null
                      ? "Checking..."
                      : projectAiAssistRuntimeStatus.hostLlmModelSelected
                        ? "Selected on host"
                        : "None selected"}
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
                <h2>Project Readiness</h2>
                <p className="ai-assist-card-subcopy">
                  These are the project-specific checks that need to be ready before AI workflows can use the current project.
                </p>
              </div>
            </div>
            <div className="home-restricted-list">
              <div className="home-restricted-item">
                <span className="home-restricted-label">AI Assist enabled</span>
                <span className={`home-restricted-value${projectAiAssistSettings.enabled ? " home-restricted-value--ready" : " home-restricted-value--pending"}`}>
                  {projectAiAssistSettings.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <div className="home-restricted-item">
                <span className="home-restricted-label">Embeddings</span>
                <span className={`home-restricted-value${indexStatus?.exists ? " home-restricted-value--ready" : " home-restricted-value--pending"}`}>
                  {embeddingStatusLabel}
                </span>
              </div>
              <div className="home-restricted-item">
                <span className="home-restricted-label">Last run</span>
                <span className="home-restricted-value">{embeddingLastRunLabel}</span>
              </div>
              <div className="home-restricted-item">
                <span className="home-restricted-label">Re-run needed</span>
                <span className={`home-restricted-value${projectEmbeddingNeedsRerun ? " home-restricted-value--pending" : " home-restricted-value--ready"}`}>
                  {projectEmbeddingRerunLabel}
                </span>
              </div>
            </div>
          </section>
        </div>

        <div className="ai-assist-home-actions-column">
          <div className="ai-assist-home-tabbar">
            <div className="segmented-control" role="tablist" aria-label="AI Assist setup views">
              <button
                type="button"
                role="tab"
                aria-selected={setupTab === "device"}
                className={setupTab === "device" ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                onClick={() => setSetupTab("device")}
              >
                Device-Level
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={setupTab === "project"}
                className={setupTab === "project" ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                onClick={() => setSetupTab("project")}
              >
                Project-Level
              </button>
            </div>
          </div>

          {setupTab === "device" ? (
            <section className="ai-assist-home-action-group">
              {!isLocalWorkspace ? (
                <section className="home-project-card ai-assist-home-card">
                  <div className="home-project-card-header">
                    <div>
                      <h2>Host Runtime</h2>
                      <p className="ai-assist-card-subcopy">
                        This project is using a host-managed AI runtime, so device-level setup is managed on the host machine.
                      </p>
                    </div>
                  </div>
                  <div className="home-restricted-list">
                    <div className="home-restricted-item">
                      <span className="home-restricted-label">Embedding model</span>
                      <span className={`home-restricted-value${remoteEmbeddingModelInstalled ? " home-restricted-value--ready" : " home-restricted-value--pending"}`}>
                        {remoteEmbeddingModelInstalled == null ? "Checking..." : remoteEmbeddingModelInstalled ? "Ready" : "Missing"}
                      </span>
                    </div>
                    <div className="home-restricted-item">
                      <span className="home-restricted-label">Host LLM</span>
                      <span className={`home-restricted-value${llmConnectionStatus === "live" ? " home-restricted-value--ready" : " home-restricted-value--pending"}`}>
                        {llmConnectionStatus === "checking" ? "Checking..." : llmConnectionStatus === "live" ? "Connected" : "Not ready"}
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
                        <h2>AI Runtime</h2>
                        <p className="ai-assist-card-subcopy">
                          Download or clear the embedding model Kanqual uses for retrieval, then open the extra details only when you need them.
                        </p>
                      </div>
                    </div>
                    {deviceError && <div className="form-error project-settings-error">{deviceError}</div>}
                    {deviceNotice && <div className="settings-success project-settings-success">{deviceNotice}</div>}
                    <div className="project-model-card">
                      <div>
                        <div className="project-model-name">{embeddingModelStatus?.displayName ?? "multilingual-e5-large"}</div>
                        <p className="project-model-description">
                          Status: {embeddingRuntimeStatusLabel}
                        </p>
                        <p className="project-model-description">
                          Size: {embeddingModelStatus?.bytes ? formatBytes(embeddingModelStatus.bytes) : "Not available yet"}
                        </p>
                        <p className="project-model-description">
                          Files: {embeddingModelStatus?.files ? `${embeddingModelStatus.files} files` : "Not available yet"}
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
                          {projectBuildBusy ? "Busy..." : "Download"}
                        </button>
                      ) : null}
                      {embeddingDownloadActive ? (
                        <button
                          className="btn"
                          type="button"
                          onClick={() => void handleEmbeddingModelCancel()}
                          disabled={!canDownloadEmbeddingModel}
                        >
                          {embeddingDownloadPhase === "cancelling" ? "Cancelling..." : "Cancel"}
                        </button>
                      ) : null}
                      {embeddingModelInstalled && !embeddingDownloadActive ? (
                        <>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => setActiveDeviceModal("download-details")}
                          >
                            Details
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
                            Clear
                          </button>
                        </>
                      ) : null}
                    </div>
                  </section>

                  <section className={`home-project-card ai-assist-home-card ai-assist-home-card--balanced${embeddingTuningAvailable ? "" : " ai-assist-home-card--disabled"}`}>
                    <div className="home-project-card-header">
                      <div>
                        <h2>Embedding Tuning</h2>
                        <p className="ai-assist-card-subcopy">
                          Adjust how Kanqual chunks and batches project content before it builds embeddings.
                        </p>
                      </div>
                    </div>
                    <div className="project-model-card">
                      <div>
                        <div className="project-model-name">Defaults</div>
                        <p className="project-model-description">
                          Chunk size: {appSettings.llm.chunkSize}
                        </p>
                        <p className="project-model-description">
                          Overlap: {appSettings.llm.overlapSize}
                        </p>
                        <p className="project-model-description">
                          Batch size: {appSettings.llm.batchSize}
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
                        Tuning
                      </button>
                    </div>
                  </section>

                  <section className="home-project-card ai-assist-home-card ai-assist-home-card--balanced">
                    <div className="home-project-card-header">
                      <div>
                        <h2>LLM Connection</h2>
                        <p className="ai-assist-card-subcopy">
                          Choose whether Kanqual should use no LLM, a local endpoint, or a future cloud provider.
                        </p>
                        <div className="settings-toggle-row settings-toggle-row--stacked settings-toggle-row--compact">
                          <div className="segmented-control ai-assist-connection-mode-toggle" role="tablist" aria-label="LLM connection mode">
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
                              None
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
                              Local
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
                              Cloud
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    {llmConnectionMode === "none" ? (
                      <div className="project-model-card">
                        <div>
                          <div className="project-model-name">LLM connections disabled</div>
                          <p className="project-model-description">
                            Kanqual will not use any LLM provider until you switch this card to Local or Cloud.
                          </p>
                        </div>
                      </div>
                    ) : null}
                    {llmConnectionMode === "local" ? (
                      <>
                        {ollamaError && <div className="form-error project-settings-error">{ollamaError}</div>}
                        <p className="ai-assist-inline-help">
                          Any local provider that exposes an OpenAI-compatible API can work here.
                        </p>
                        <div className={llmServerCardClassName}>
                          <div>
                            <div className="project-model-name">LLM server</div>
                            <p className="project-model-description">
                              Endpoint: <code>{appSettings.llm.ollamaProtocol}://{appSettings.llm.ollamaHost}:{appSettings.llm.ollamaPort}</code>
                            </p>
                            <p className="project-model-description">
                              Status: {ollamaDiscovery?.ok ? "Connected" : "Not tested yet"}
                            </p>
                            <p className="project-model-description">
                              Version: {ollamaDiscovery?.version || "Not available"}
                            </p>
                            <p className="project-model-description">
                              Models: {ollamaDiscovery?.ok ? `${ollamaDiscovery.modelCount} found` : "Not loaded"}
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
                            {ollamaBusy ? "Testing..." : "Test"}
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
                            API provider
                            <span className="settings-field-hint">Choose the cloud service Kanqual should target.</span>
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
                              Open key setup
                            </a>
                          </p>
                          <div className={cloudProviderCardClassName}>
                            <div>
                              <div className="project-model-name">{selectedCloudProvider.label} endpoint</div>
                              <p className="project-model-description">
                                Status: {cloudDiscovery?.ok ? "Connected" : cloudBusy ? "Testing..." : "Not tested yet"}
                              </p>
                              <p className="project-model-description">
                                Endpoint: <code>{cloudDiscovery?.baseUrl || (
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
                                Models: {cloudDiscovery?.ok ? `${cloudDiscovery.modelCount} available` : "Load after a successful test"}
                              </p>
                            </div>
                          </div>
                          <label className="form-label">
                            API secret
                            <span className="settings-field-hint">Paste the secret key for the selected provider.</span>
                            <input
                              className="form-input"
                              type="password"
                              autoComplete="off"
                              value={appSettings.llm.cloudApiSecret}
                              onChange={(e) => handleCloudSecretChange(e.target.value)}
                              placeholder={`Enter your ${selectedCloudProvider.label} API secret`}
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
                            {cloudBusy ? "Testing..." : "Test"}
                          </button>
                        </div>
                      </>
                    ) : null}
                  </section>

                  <section className={`home-project-card ai-assist-home-card${generationDefaultsAvailable ? "" : " ai-assist-home-card--disabled"}`}>
                    <div className="home-project-card-header">
                      <div>
                        <h2>Generation Defaults</h2>
                        <p className="ai-assist-card-subcopy">
                          Choose the model Kanqual should use, then expand the advanced defaults only when you want to tune generation behavior.
                        </p>
                      </div>
                    </div>
                    <fieldset className="llm-settings-grid llm-settings-grid--single" disabled={!canManageLlmSettings || !generationDefaultsAvailable} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
                      <label className="form-label">
                        {llmConnectionMode === "cloud" ? "Available cloud model" : "Available local model"}
                        <span className="settings-field-hint">
                          {llmConnectionMode === "cloud"
                            ? "Test the cloud connection first to load the models available for the selected provider."
                            : "Test the connection first to load installed models from this server."}
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
                              ? (generationModelOptions.length === 0 ? "No cloud models loaded yet" : "Select a model")
                              : (generationModelOptions.length === 0 ? "No models loaded yet" : "Select a model")}
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
                        Defaults
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
                      <h2>Project AI Assist</h2>
                      <p className="ai-assist-card-subcopy">
                        Turn AI assistance on or off for this project. Device setup alone does not enable AI features inside the project.
                      </p>
                    </div>
                  </div>
                  {(projectError || projectBuildError) && (
                    <div className="form-error project-settings-error">{projectError || projectBuildError}</div>
                  )}
                  {projectNotice && <div className="settings-success project-settings-success">{projectNotice}</div>}
                  <label className="settings-toggle-row">
                    <span>
                      <strong>Enable AI assistance in this project</strong>
                      <small>When disabled, project AI features stay off even if the device runtime is configured.</small>
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
                      <h2>Embedding Management</h2>
                      <p className="ai-assist-card-subcopy">
                        Review the current index for this project and rebuild or delete embeddings when the project changes.
                      </p>
                    </div>
                  </div>
                  <div className="app-settings-stats ai-assist-embedding-stats">
                    <div className="app-settings-stat-card">
                      <strong>{embeddingStatusLabel}</strong>
                      <span>{indexStatus?.modelDisplayName ?? "multilingual-e5"}</span>
                      <small>{embeddingStatusDetail}</small>
                    </div>
                  </div>
                  <div className="form-actions" style={{ marginTop: 16, justifyContent: "flex-start" }}>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setBuildModalOpen(true)}
                      disabled={projectBuildBusy || !canBuildProjectEmbeddings}
                      title={canBuildProjectEmbeddings ? undefined : "You do not have permission to build project embeddings."}
                    >
                      {projectBuildPhase === "running"
                        ? "Building..."
                        : indexStatus?.exists
                          ? "Rebuild"
                          : "Run"}
                    </button>
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={() => void handleDeleteAiAssistEmbeddings()}
                      disabled={projectBuildBusy || aiAssistDeletingIndex || !indexStatus?.exists || !canDeleteProjectEmbeddings}
                      style={{ marginLeft: "auto" }}
                      title={
                        !canDeleteProjectEmbeddings
                          ? "You do not have permission to delete project embeddings."
                          : !indexStatus?.exists
                            ? "No project embeddings are available to delete."
                            : undefined
                      }
                    >
                      {aiAssistDeletingIndex ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                  {!canBuildProjectEmbeddings && !canDeleteProjectEmbeddings && (
                    <div className="users-permission-note">
                      You can view project embedding status, but you do not have permission to rebuild or delete embeddings.
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
            <h2>AI Assist Help</h2>
            <p className="users-guide-copy">
              Use AI Assist Home as the main control center for both runtime setup and project AI readiness.
            </p>
            <p className="users-guide-copy">
              Device-Level Setup manages the embedding model and LLM connection on this machine. Project-Level Setup manages whether this project can use AI Assist and whether its embeddings are ready.
            </p>
            <p className="users-guide-copy">
              Remote workspaces may rely on a host-managed runtime, so some device controls may appear as status-only instead of editable settings.
            </p>
            <div className="form-actions">
              <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <DeviceDetailsModal
        open={activeDeviceModal === "download-details"}
        title="Embedding Download Details"
        onClose={() => setActiveDeviceModal(null)}
      >
        <ul className="ai-assist-settings-summary-list">
          <li>
            <strong>Repository:</strong> <code>{embeddingModelStatus?.repoId ?? "intfloat/multilingual-e5-large"}</code>
          </li>
          <li>
            <strong>Total download:</strong> {formatBytes(embeddingModelPreflight?.totalBytes ?? 0)}
          </li>
          <li>
            <strong>Already on device:</strong> {formatBytes(embeddingModelPreflight?.existingBytes ?? embeddingModelStatus?.bytes ?? 0)}
            {embeddingModelPreflight?.manifestAvailable ? ` | ${embeddingModelPreflight?.existingFiles ?? 0} files` : ""}
          </li>
          <li>
            <strong>Remaining:</strong> {formatBytes(embeddingModelPreflight?.remainingBytes ?? 0)}
            {embeddingModelPreflight?.manifestAvailable && embeddingModelPreflight?.remainingFiles != null
              ? ` across ${embeddingModelPreflight.remainingFiles} files`
              : ""}
          </li>
          <li>
            <strong>Downloaded:</strong> {formatDownloadDate(embeddingModelStatus?.downloadedAtMs)}
          </li>
          <li>
            <strong>Location:</strong> <code>{embeddingModelStatus?.modelDir ?? "Detecting local model directory..."}</code>
          </li>
        </ul>
      </DeviceDetailsModal>

      <DeviceDetailsModal
        open={activeDeviceModal === "embedding-tuning"}
        title="Embedding Tuning"
        onClose={() => setActiveDeviceModal(null)}
      >
        <div className="llm-settings-grid">
          <label className="form-label">
            Chunk size
            <span className="settings-field-hint">Text size for each embedding chunk.</span>
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
            Overlap size
            <span className="settings-field-hint">Shared text between neighboring chunks.</span>
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
            Batch size
            <span className="settings-field-hint">Chunks processed together during indexing.</span>
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
        title="Connection Settings"
        onClose={() => setActiveDeviceModal(null)}
      >
        <fieldset className="llm-settings-grid" disabled={!canManageLlmSettings} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          <label className="form-label">
            Protocol
            <span className="settings-field-hint">Most local setups use plain HTTP.</span>
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
            Host / URL
            <span className="settings-field-hint">Usually <code>127.0.0.1</code> or <code>localhost</code>.</span>
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
            Port
            <span className="settings-field-hint">Default for many local servers: <code>11434</code>.</span>
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
            Request timeout
            <span className="settings-field-hint">Seconds to wait when testing or listing models.</span>
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
        title="Advanced Generation Defaults"
        onClose={() => setActiveDeviceModal(null)}
      >
        <fieldset className="llm-settings-grid" disabled={!canManageLlmSettings} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          <label className="form-label">
            Temperature
            <span className="settings-field-hint">Lower values are more deterministic.</span>
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
            Context window
            <span className="settings-field-hint">Default <code>num_ctx</code> target for future requests.</span>
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
            Keep alive (minutes)
            <span className="settings-field-hint">Keeps models warm between requests.</span>
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
            Relevant-segment shortlist
            <span className="settings-field-hint">Top matches sent to the model before it narrows them down.</span>
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
            Relevant segments returned
            <span className="settings-field-hint">Maximum number of segments returned to AI Assisted Coding.</span>
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
              setProjectNotice("Project embeddings are preparing in the background.");
              setBuildModalOpen(false);
            }
          });
        }}
      />
    </div>
  );
}
