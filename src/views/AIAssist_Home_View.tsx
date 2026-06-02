import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../context/StoreContext";
import { readAppSettings } from "../lib/appSettings";
import {
  buildProjectEmbeddingItems,
  type ProjectEmbeddingIndexStatus,
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

function useEmbeddingRunState() {
  const {
    activeProject,
    userRole,
    setView,
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
  const [indexStatus, setIndexStatus] = useState<ProjectEmbeddingIndexStatus | null>(null);
  const [modelStatus, setModelStatus] = useState<EmbeddingModelStatus | null>(null);
  const [error, setError] = useState("");
  const [buildModalOpen, setBuildModalOpen] = useState(false);
  const busy =
    projectEmbeddingBuildStatus?.phase === "running" || projectEmbeddingBuildStatus?.phase === "cancelling";

  useEffect(() => {
    const projectId = activeProject?.id;
    if (!projectId) {
      setIndexStatus(null);
      setModelStatus(null);
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
      setModelStatus(
        projectAiAssistRuntimeStatus.hostEmbeddingModelInstalled == null
          ? null
          : {
              installed: Boolean(projectAiAssistRuntimeStatus.hostEmbeddingModelInstalled),
              repoId: "",
              displayName: "",
              modelDir: "",
              files: 0,
              bytes: 0,
              downloadedAtMs: null,
            },
      );
      setError("");
      return;
    }

    let cancelled = false;
    async function refreshStatuses() {
      try {
        const [nextIndexStatus, nextModelStatus] = await Promise.all([
          invoke<ProjectEmbeddingIndexStatus>("get_project_embedding_index_status", { projectId }),
          invoke<EmbeddingModelStatus>("get_multilingual_e5_status"),
        ]);
        if (cancelled) return;
        setIndexStatus(nextIndexStatus);
        setModelStatus(nextModelStatus);
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
    projectAiAssistRuntimeStatus.hostEmbeddingModelInstalled,
    projectAiAssistRuntimeStatus.hostProjectEmbeddingsReady,
    projectEmbeddingBuildStatus?.phase,
    projectEmbeddingBuildStatus?.projectId,
  ]);

  function openBuildModal() {
    setError("");
    setBuildModalOpen(true);
  }

  async function handleRunEmbedding() {
    if (!activeProject) return false;
    setError("");

    try {
      if (isLocalWorkspace) {
        const latestModelStatus = await invoke<EmbeddingModelStatus>("get_multilingual_e5_status");
        setModelStatus(latestModelStatus);
        if (!latestModelStatus.installed) {
          sessionStorage.setItem("kanqual:open-app-settings-modal", "llm");
          setView("app-settings");
          return false;
        }

        const llmSettings = readAppSettings().llm;
        const items = buildProjectEmbeddingItems(documents, cases, codes, annotations, memos, llmSettings);
        if (items.length === 0) {
          setError("There is no project content available to embed yet.");
          return false;
        }

        await startProjectEmbeddingBuild({
          projectId: activeProject.id,
          llmSettings,
          items,
          successLog: {
            projectId: activeProject.id,
            action: "ai_assist.reindex",
            label: "Rebuilt local AI Assist embeddings",
          },
        });
      } else {
        if (projectAiAssistRuntimeStatus.hostEmbeddingModelInstalled === false) {
          setError("The host device still needs the multilingual-e5 embedding model before it can build project embeddings.");
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
          items: [],
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
    userRole,
    setView,
    indexStatus,
    modelStatus,
    busy,
    error,
    buildModalOpen,
    setBuildModalOpen,
    openBuildModal,
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
      <div className="modal modal--wide app-settings-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="ai-assist-rerun-title">
        <div className="settings-section-header">
          <div>
            <h2 id="ai-assist-rerun-title" className="settings-section-title">{hasExistingIndex ? "Rebuild Project Embeddings" : "Run Project Embeddings"}</h2>
            <p className="settings-section-desc">
              Kanqual is refreshing the local multilingual-e5 index for this project.
            </p>
          </div>
        </div>
        <div className="app-settings-modal-body">
          <div className="project-model-modal-copy">
            <p>
              This is mostly a first-run style task, but you can rerun it any time the project changes enough that you want a fresh AI Assist index.
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

export function AIAssistView() {
  const { canCurrentUser, isLocalWorkspace, projectAiAssistRuntimeStatus } = useStore();
  const {
    activeProject,
    setView,
    indexStatus,
    modelStatus,
    error,
    buildModalOpen,
    setBuildModalOpen,
    handleRunEmbedding,
  } = useEmbeddingRunState();
  const { projectAiAssistSettings } = useStore();
  const llmSettings = readAppSettings().llm;
  const aiAssistProjectSettings = activeProject ? projectAiAssistSettings : null;
  const [llmConnectionStatus, setLlmConnectionStatus] = useState<"checking" | "live" | "offline" | "disabled">(
    isLocalWorkspace
      ? (llmSettings.ollamaEnabled ? "checking" : "disabled")
      : "checking",
  );
  const [helpOpen, setHelpOpen] = useState(false);
  const canViewAiAssistHome = canCurrentUser("viewAiAssistHome");
  const canManageLlmSettings = canCurrentUser("manageLlmSettings");
  const canDownloadEmbeddingModel = canCurrentUser("downloadEmbeddingModel");
  const canManageProjectAiAssist =
    canCurrentUser("enableProjectAiAssist")
    || canCurrentUser("buildEmbeddings")
    || canCurrentUser("deleteEmbeddings");
  const remoteEmbeddingModelInstalled = projectAiAssistRuntimeStatus.hostEmbeddingModelInstalled;
  const remoteEmbeddingsReady = projectAiAssistRuntimeStatus.hostProjectEmbeddingsReady;
  const aiAssistRequirements = [
    {
      label: "Embeddings model download",
      met: isLocalWorkspace ? Boolean(modelStatus?.installed) : remoteEmbeddingModelInstalled === true,
      value: isLocalWorkspace
        ? (modelStatus?.installed ? "Ready" : "Missing")
        : remoteEmbeddingModelInstalled == null
          ? "Checking..."
          : remoteEmbeddingModelInstalled
            ? "Ready"
            : "Missing",
      disabled: !(canManageLlmSettings || canDownloadEmbeddingModel),
      onClick: () => {
        sessionStorage.setItem("kanqual:open-app-settings-modal", "llm");
        setView("app-settings");
      },
    },
    {
      label: isLocalWorkspace ? "Local LLM connection" : "Host LLM connection",
      met: llmConnectionStatus === "live",
      value:
        llmConnectionStatus === "checking"
          ? "Checking..."
          : llmConnectionStatus === "live"
            ? "Ready"
            : llmConnectionStatus === "disabled"
              ? "Disabled"
              : "Offline",
      disabled: !canManageLlmSettings,
      onClick: () => {
        sessionStorage.setItem("kanqual:open-app-settings-modal", "llm");
        setView("app-settings");
      },
    },
    {
      label: "AI Assist enabled in project settings",
      met: Boolean(aiAssistProjectSettings?.enabled),
      value: aiAssistProjectSettings?.enabled ? "Enabled" : "Disabled",
      disabled: !canManageProjectAiAssist,
      onClick: () => {
        sessionStorage.setItem("kanqual:open-project-settings-modal", "ai-assist");
        setView("project-settings");
      },
    },
    {
      label: "Embeddings built",
      met: isLocalWorkspace ? Boolean(indexStatus?.exists) : remoteEmbeddingsReady === true,
      value: isLocalWorkspace
        ? (indexStatus?.exists ? "Ready" : "Not Built")
        : remoteEmbeddingsReady == null
          ? "Checking..."
          : remoteEmbeddingsReady
            ? "Ready"
            : "Not Built",
      disabled: !canManageProjectAiAssist,
      onClick: () => {
        sessionStorage.setItem("kanqual:open-project-settings-modal", "ai-assist");
        setView("project-settings");
      },
    },
  ];

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
    if (!llmSettings.ollamaEnabled) {
      setLlmConnectionStatus("disabled");
      return;
    }

    let cancelled = false;
    setLlmConnectionStatus("checking");
    void invoke<number>("ping_address", {
      host: llmSettings.ollamaHost,
      port: llmSettings.ollamaPort,
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
    isLocalWorkspace,
    llmSettings.ollamaEnabled,
    llmSettings.ollamaHost,
    llmSettings.ollamaPort,
    projectAiAssistRuntimeStatus.hostLlmConnectionLive,
    projectAiAssistRuntimeStatus.hostLlmEnabled,
    projectAiAssistRuntimeStatus.hostLlmModelSelected,
  ]);

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

      {error && <div className="form-error project-settings-error">{error}</div>}

        <div className="home-dashboard ai-assist-home-dashboard">
        <div className="home-stats-grid">
          <section className="home-project-card ai-assist-home-card ai-assist-home-card--status" aria-label="AI Assist status">
            <div className="home-project-card-header">
              <div>
                <h2>Status</h2>
                <p className="ai-assist-card-subcopy">
                  These four requirements need to be in place for the full AI Assist workflow to be ready.
                </p>
              </div>
            </div>
            <div className="home-restricted-list">
              {aiAssistRequirements.map((requirement) => (
                <button
                  key={requirement.label}
                  type="button"
                  className="home-restricted-item home-restricted-item--clickable"
                  onClick={requirement.onClick}
                  disabled={requirement.disabled}
                  title={requirement.disabled ? "You do not have permission to change this setting" : undefined}
                >
                  <span className="home-restricted-label">{requirement.label}</span>
                  <span className={`home-restricted-value${requirement.met ? " home-restricted-value--ready" : " home-restricted-value--pending"}`}>
                    {requirement.value}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal modal--help" onClick={(e) => e.stopPropagation()}>
            <h2>AI Assist Help</h2>
            <p className="users-guide-copy">
              Open AI Assist tools, review which tools are available, jump to chat, coding, process-documents, analyze, or attribute workflows, and inspect host or runtime readiness indicators.
            </p>
            <p className="users-guide-copy">
              Use AI Assist Home as the launch page for AI features. Review which tools are available for your role and current project, then choose the workflow you want to run.
            </p>
            <p className="users-guide-copy">
              Remote users may be using host-executed AI rather than their own local runtime. Availability can change if the project disables AI Assist or if the host runtime is not ready.
            </p>
            <div className="form-actions">
              <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <EmbeddingBuildModal
        buildModalOpen={buildModalOpen}
        hasExistingIndex={!!indexStatus?.exists}
        onClose={() => setBuildModalOpen(false)}
        onRun={() => {
          void handleRunEmbedding().then((started) => {
            if (started) setBuildModalOpen(false);
          });
        }}
      />

    </div>
  );
}
