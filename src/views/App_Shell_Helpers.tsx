import {
  Component,
  type ErrorInfo,
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAuth } from "../context/AuthContext";
import { useStore } from "../context/StoreContext";
import { useI18n } from "../i18n/provider";
import { APP_SETTINGS_KEY } from "../lib/appSettings";
import {
  cancelPostgresProjectEmbeddingStoreBuild,
  type PostgresProject,
  type PostgresProjectChangeEvent,
  POSTGRES_PROJECT_CHANGED_EVENT,
} from "../lib/postgres";
import type { ProjectEmbeddingBuildStatus } from "../lib/projectEmbeddings";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  loadProjectBackupBannerIssue,
  OPEN_PROJECT_SETTINGS_MODAL_EVENT,
  PROJECT_BACKUPS_CHANGED_EVENT,
  type ProjectBackupBannerIssue,
} from "../lib/projectBackupBanner";

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

type AppErrorBoundaryState = {
  errorMessage: string | null;
  componentStack: string;
};

type AppErrorBoundaryCopy = {
  title: string;
  body: string;
  stackTitle: string;
  reload: string;
  reset: string;
};

class AppErrorBoundary extends Component<{ children: ReactNode; copy: AppErrorBoundaryCopy }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    errorMessage: null,
    componentStack: "",
  };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return {
      errorMessage: describeUnknownError(error),
      componentStack: "",
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("App render failed:", error, info);
    this.setState({
      errorMessage: describeUnknownError(error),
      componentStack: info.componentStack ?? "",
    });
  }

  private resetUiState() {
    if (typeof window === "undefined") return;

    sessionStorage.removeItem("kanqual:open-app-settings-modal");
    sessionStorage.removeItem("kanqual:open-project-settings-modal");
    sessionStorage.removeItem("kanqual:open-project-users-tab");

    try {
      const raw = localStorage.getItem(APP_SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { ui?: { locale?: string } };
        localStorage.setItem(
          APP_SETTINGS_KEY,
          JSON.stringify({
            ...parsed,
            ui: {
              ...parsed.ui,
              locale: "en",
            },
          }),
        );
      }
    } catch (error) {
      console.warn("Failed to reset app locale after render crash:", error);
    }
  }

  render() {
    if (!this.state.errorMessage) {
      return this.props.children;
    }

    return (
      <div className="auth-screen">
        <div className="auth-card" style={{ maxWidth: 760 }}>
          <div className="auth-brand">Kanqual</div>
          <h2 className="auth-panel-title">{this.props.copy.title}</h2>
          <p className="auth-hint">{this.props.copy.body}</p>
          <p className="auth-error">{this.state.errorMessage}</p>
          {this.state.componentStack ? (
            <pre className="settings-code-line" style={{ whiteSpace: "pre-wrap" }}>
              {this.props.copy.stackTitle}
              {"\n"}
              {this.state.componentStack.trim()}
            </pre>
          ) : null}
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => window.location.reload()}>
              {this.props.copy.reload}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                this.resetUiState();
                window.location.reload();
              }}
            >
              {this.props.copy.reset}
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export function AppErrorBoundaryWithI18n({ children }: { children: ReactNode }) {
  const { t } = useI18n();

  return (
    <AppErrorBoundary
      copy={{
        title: t("app.errorBoundary.title"),
        body: t("app.errorBoundary.body"),
        stackTitle: t("app.errorBoundary.stackTitle"),
        reload: t("app.errorBoundary.reload"),
        reset: t("app.errorBoundary.reset"),
      }}
    >
      {children}
    </AppErrorBoundary>
  );
}

function formatDurationEstimate(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.max(1, Math.round((seconds % 3600) / 60));
  return `${hours} hr ${minutes} min`;
}

function formatElapsedRuntime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function formatGigabytes(value: number): string {
  return `${(value / (1024 ** 3)).toFixed(2)} GB`;
}

function formatPercent(value: number | null): string {
  return value == null ? "--" : `${Math.max(0, Math.min(100, value)).toFixed(0)}%`;
}

export type ReleaseCheckResult = {
  latestVersion: string;
  releaseUrl: string;
};

const UPDATE_RELEASES_URL = "https://github.com/KanQual/kanqual/releases";

function normalizeSemver(version: string): number[] {
  const clean = version.trim().replace(/^v/i, "").split("-")[0];
  const parts = clean.split(".").map((part) => Number.parseInt(part, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

export function compareSemver(a: string, b: string): number {
  const left = normalizeSemver(a);
  const right = normalizeSemver(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function fetchLatestRelease(): Promise<ReleaseCheckResult | null> {
  const response = await fetch("https://api.github.com/repos/KanQual/kanqual/releases/latest", {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub release check failed with status ${response.status}.`);
  const release = await response.json() as Record<string, unknown>;
  if (typeof release.tag_name !== "string") return null;
  return {
    latestVersion: release.tag_name,
    releaseUrl: typeof release.html_url === "string" ? release.html_url : UPDATE_RELEASES_URL,
  };
}

export function UpdateAvailableBanner({
  version,
  releaseUrl,
  onDismiss,
}: {
  version: string;
  releaseUrl: string;
  onDismiss: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="embedding-build-banner embedding-build-banner--completed">
      <div className="embedding-build-banner-copy">
        <strong>{t("app.updateBanner.title")}</strong>
        <span>{t("app.updateBanner.versionBody", { version })}</span>
        <span>{t("app.updateBanner.detail")}</span>
      </div>
      <div className="embedding-build-banner-actions">
        <a className="btn btn--primary" href={releaseUrl} target="_blank" rel="noreferrer">
          {t("app.updateBanner.viewRelease")}
        </a>
        <button type="button" className="btn" onClick={onDismiss}>
          {t("common.dismiss")}
        </button>
      </div>
    </div>
  );
}

export function ProjectBackupBanner() {
  const { t } = useI18n();
  const { activeProject, canCurrentUser, setView } = useStore();
  const [issue, setIssue] = useState<ProjectBackupBannerIssue | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refreshBackupBanner() {
      if (
        !activeProject
        || !(canCurrentUser("manageBackupsAndRestores")
          || canCurrentUser("exportProject")
          || canCurrentUser("restoreProjectBackup"))
      ) {
        if (!cancelled) setIssue(null);
        return;
      }

      const nextIssue = await loadProjectBackupBannerIssue(activeProject);
      if (!cancelled) setIssue(nextIssue);
    }

    void refreshBackupBanner();

    function handleBackupsChanged(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail as { projectId?: string } | undefined : undefined;
      if (detail?.projectId && activeProject && detail.projectId !== activeProject.id) return;
      void refreshBackupBanner();
    }

    window.addEventListener(PROJECT_BACKUPS_CHANGED_EVENT, handleBackupsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(PROJECT_BACKUPS_CHANGED_EVENT, handleBackupsChanged);
    };
  }, [activeProject, canCurrentUser]);

  if (!activeProject || !issue) return null;

  const toneClass = issue.kind === "failed" ? "embedding-build-banner--error" : "embedding-build-banner--warning";
  const bannerCopy =
    issue.kind === "failed"
      ? {
          title: t("app.backupBanner.failedTitle"),
          detail: t("app.backupBanner.failedDetail"),
          actionLabel: t("app.backupBanner.failedAction"),
        }
      : issue.kind === "interrupted"
        ? {
            title: t("app.backupBanner.interruptedTitle"),
            detail: t("app.backupBanner.interruptedDetail"),
            actionLabel: t("app.backupBanner.interruptedAction"),
          }
        : {
            title: t("app.backupBanner.missingTitle"),
            detail: t("app.backupBanner.missingDetail"),
            actionLabel: t("app.backupBanner.missingAction"),
          };

  function openBackupSettings() {
    sessionStorage.setItem("kanqual:open-project-settings-modal", "backups");
    window.dispatchEvent(new CustomEvent(OPEN_PROJECT_SETTINGS_MODAL_EVENT));
    setView("project-settings");
  }

  return (
    <div className={`embedding-build-banner ${toneClass}`}>
      <div className="embedding-build-banner-copy">
        <strong>{bannerCopy.title}</strong>
        <span>{issue.message}</span>
        <span>{bannerCopy.detail}</span>
      </div>
      <div className="embedding-build-banner-actions">
        <button type="button" className="btn btn--primary" onClick={openBackupSettings}>
          {bannerCopy.actionLabel}
        </button>
      </div>
    </div>
  );
}

export function ForcePasswordChangeView() {
  const { t } = useI18n();
  const { user, changePassword, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError(t("app.forcePassword.enterTemporary"));
      return;
    }
    if (newPassword.length < 8) {
      setError(t("app.forcePassword.passwordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("app.forcePassword.passwordsDoNotMatch"));
      return;
    }
    setSaving(true);
    try {
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : t("app.forcePassword.passwordChangeFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">Kanqual</div>
        <p className="auth-tagline">{t("app.forcePassword.tagline")}</p>
        <form onSubmit={handleSubmit} className="form">
          <h2 className="auth-panel-title">{t("app.forcePassword.title")}</h2>
          <p className="auth-hint">{t("app.forcePassword.temporaryNotice")}</p>
          <p className="auth-hint">{t("app.forcePassword.signedInAs", { email: user?.email ?? "" })}</p>
          <label className="form-label">
            {t("app.forcePassword.temporaryPassword")}
            <input className="form-input" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoFocus autoComplete="current-password" />
          </label>
          <label className="form-label">
            {t("app.forcePassword.newPassword")}
            <input className="form-input" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
          </label>
          <label className="form-label">
            {t("app.forcePassword.confirmPassword")}
            <input className="form-input" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
          </label>
          {error && <p className="auth-error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn" onClick={logout} disabled={saving}>
              {t("common.signOut")}
            </button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? t("app.forcePassword.updating") : t("app.forcePassword.setPassword")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ProjectEmbeddingBuildBanner() {
  const { t } = useI18n();
  const {
    projectEmbeddingBuildStatus,
    projectEmbeddingBuildBannerOpen,
    cancelProjectEmbeddingBuild,
    dismissProjectEmbeddingBanner,
    projects,
    activeProject,
  } = useStore();
  const [nowMs, setNowMs] = useState(Date.now());

  const phase = projectEmbeddingBuildStatus?.phase ?? "idle";
  const isActive = phase === "running" || phase === "cancelling";
  useEffect(() => {
    if (!isActive) return;
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [isActive]);

  if (!projectEmbeddingBuildBannerOpen || !projectEmbeddingBuildStatus) return null;
  const progressPercent = Math.max(0, Math.min(100, projectEmbeddingBuildStatus.progressPercent ?? 0));
  const progressFillPercent = isActive ? Math.max(8, progressPercent) : progressPercent;
  const showIndeterminateProgress = isActive && progressPercent <= 0;
  const etaSeconds =
    isActive
      && projectEmbeddingBuildStatus.startedAtMs
      && projectEmbeddingBuildStatus.completedItems > 0
      && projectEmbeddingBuildStatus.totalItems > projectEmbeddingBuildStatus.completedItems
      ? Math.max(
          1,
          Math.round(
            ((Date.now() - projectEmbeddingBuildStatus.startedAtMs) / 1000)
            / projectEmbeddingBuildStatus.completedItems
            * (projectEmbeddingBuildStatus.totalItems - projectEmbeddingBuildStatus.completedItems),
          ),
        )
      : null;
  const bannerProjectName =
    (projectEmbeddingBuildStatus.projectId
      ? projects.find((project) => project.id === projectEmbeddingBuildStatus.projectId)?.name
      : null)
    ?? (activeProject?.id === projectEmbeddingBuildStatus.projectId ? activeProject.name : null);
  const elapsedRuntime = isActive && projectEmbeddingBuildStatus.startedAtMs
    ? formatElapsedRuntime(nowMs - projectEmbeddingBuildStatus.startedAtMs)
    : null;

  return (
    <div className={`embedding-build-banner embedding-build-banner--${phase}`}>
      <div className="embedding-build-banner-copy">
        <strong>
          {phase === "running" && t("app.embeddingBuild.runningTitle")}
          {phase === "cancelling" && t("app.embeddingBuild.cancellingTitle")}
          {phase === "completed" && t("app.embeddingBuild.completedTitle")}
          {phase === "cancelled" && t("app.embeddingBuild.cancelledTitle")}
          {phase === "error" && t("app.embeddingBuild.errorTitle")}
        </strong>
        <span>{projectEmbeddingBuildStatus.message ?? t("app.embeddingBuild.itemsProcessed", { completed: projectEmbeddingBuildStatus.completedItems, total: projectEmbeddingBuildStatus.totalItems })}</span>
        {isActive && (
          <div className="embedding-build-banner-meta">
            {bannerProjectName && <span>{t("app.embeddingBuild.project", { name: bannerProjectName })}</span>}
            <span>{t("app.embeddingBuild.progress", { value: formatPercent(projectEmbeddingBuildStatus.progressPercent) })}</span>
            {projectEmbeddingBuildStatus.currentSourceIndex && projectEmbeddingBuildStatus.totalSources ? (
              <span>{t("app.embeddingBuild.sourceProgress", { current: projectEmbeddingBuildStatus.currentSourceIndex, total: projectEmbeddingBuildStatus.totalSources })}</span>
            ) : null}
            {elapsedRuntime && <span>{t("app.embeddingBuild.runtime", { value: elapsedRuntime })}</span>}
            <span>{t("app.embeddingBuild.eta", { value: etaSeconds != null ? formatDurationEstimate(etaSeconds) : t("app.embeddingBuild.estimating") })}</span>
            {projectEmbeddingBuildStatus.currentLabel && <span title={projectEmbeddingBuildStatus.currentLabel}>{t("app.embeddingBuild.current", { label: projectEmbeddingBuildStatus.currentLabel })}</span>}
          </div>
        )}
        {isActive && (
          <div className="embedding-build-banner-progress">
            <div className={`model-download-progress-track${showIndeterminateProgress ? " model-download-progress-track--indeterminate" : ""}`} aria-hidden="true">
              <div className="model-download-progress-fill model-download-progress-fill--active" style={{ width: showIndeterminateProgress ? "34%" : `${progressFillPercent}%` }} />
            </div>
          </div>
        )}
      </div>
      <div className="embedding-build-banner-actions">
        {isActive ? (
          <button type="button" className="btn" onClick={() => void cancelProjectEmbeddingBuild()}>
            {phase === "cancelling" ? t("app.embeddingBuild.cancellingAction") : t("app.embeddingBuild.cancelAction")}
          </button>
        ) : (
          <button type="button" className="btn" onClick={dismissProjectEmbeddingBanner}>
            {t("common.dismiss")}
          </button>
        )}
      </div>
    </div>
  );
}

export function PostgresProjectEmbeddingBuildBanner({
  activeProject,
}: {
  activeProject: PostgresProject | null;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<ProjectEmbeddingBuildStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const previousPhaseRef = useRef<ProjectEmbeddingBuildStatus["phase"] | null>(null);
  const phase = status?.phase ?? "idle";
  const isActive = phase === "running" || phase === "cancelling";

  function applyNextStatus(nextStatus: ProjectEmbeddingBuildStatus) {
    const previousPhase = previousPhaseRef.current;
    const nextIsActive = nextStatus.phase === "running" || nextStatus.phase === "cancelling";
    const previousWasActive = previousPhase === "running" || previousPhase === "cancelling";

    setStatus(nextStatus);
    previousPhaseRef.current = nextStatus.phase;

    if (nextIsActive || previousWasActive) {
      setOpen(nextStatus.phase !== "idle");
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function refreshStatus() {
      try {
        const nextStatus = await invoke<ProjectEmbeddingBuildStatus>("get_project_embedding_store_build_status");
        if (cancelled) return;
        applyNextStatus(nextStatus);
      } catch (error) {
        console.warn("Could not load PostgreSQL embedding build status:", describeUnknownError(error));
      }
    }

    void refreshStatus();
    const intervalId = window.setInterval(() => {
      void refreshStatus();
    }, isActive ? 1500 : 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [isActive]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen<PostgresProjectChangeEvent>(POSTGRES_PROJECT_CHANGED_EVENT, (event) => {
      if (event.payload.entityType === "project_embeddings") {
        void invoke<ProjectEmbeddingBuildStatus>("get_project_embedding_store_build_status")
          .then((nextStatus) => {
            applyNextStatus(nextStatus);
          })
          .catch((error) => {
            console.warn("Could not refresh PostgreSQL embedding build status:", describeUnknownError(error));
          });
      }
    }).then((nextUnlisten) => {
      unlisten = nextUnlisten;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  if (!open || !status || phase === "idle") return null;

  const progressPercent = Math.max(0, Math.min(100, status.progressPercent ?? 0));
  const progressFillPercent = isActive ? Math.max(8, progressPercent) : progressPercent;
  const showIndeterminateProgress = isActive && progressPercent <= 0;
  const etaSeconds =
    isActive
      && status.startedAtMs
      && status.completedItems > 0
      && status.totalItems > status.completedItems
      ? Math.max(
          1,
          Math.round(
            ((Date.now() - status.startedAtMs) / 1000)
            / status.completedItems
            * (status.totalItems - status.completedItems),
          ),
        )
      : null;
  const bannerProjectName = activeProject?.id === status.projectId ? activeProject.name : null;
  const elapsedRuntime = isActive && status.startedAtMs
    ? formatElapsedRuntime(nowMs - status.startedAtMs)
    : null;

  async function handleCancel() {
    try {
      const nextStatus = await cancelPostgresProjectEmbeddingStoreBuild();
      setStatus(nextStatus);
      setOpen(true);
    } catch (error) {
      setStatus((current) => current
        ? {
            ...current,
            phase: "error",
            message: describeUnknownError(error),
          }
        : current);
      setOpen(true);
    }
  }

  return (
    <div className={`embedding-build-banner embedding-build-banner--${phase}`}>
      <div className="embedding-build-banner-copy">
        <strong>
          {phase === "running" && t("app.embeddingBuild.runningTitle")}
          {phase === "cancelling" && t("app.embeddingBuild.cancellingTitle")}
          {phase === "completed" && t("app.embeddingBuild.completedTitle")}
          {phase === "cancelled" && t("app.embeddingBuild.cancelledTitle")}
          {phase === "error" && t("app.embeddingBuild.errorTitle")}
        </strong>
        <span>{status.message ?? t("app.embeddingBuild.itemsProcessed", { completed: status.completedItems, total: status.totalItems })}</span>
        {isActive && (
          <div className="embedding-build-banner-meta">
            {bannerProjectName && <span>{t("app.embeddingBuild.project", { name: bannerProjectName })}</span>}
            <span>{t("app.embeddingBuild.progress", { value: formatPercent(status.progressPercent) })}</span>
            {status.currentSourceIndex && status.totalSources ? (
              <span>{t("app.embeddingBuild.sourceProgress", { current: status.currentSourceIndex, total: status.totalSources })}</span>
            ) : null}
            {elapsedRuntime && <span>{t("app.embeddingBuild.runtime", { value: elapsedRuntime })}</span>}
            <span>{t("app.embeddingBuild.eta", { value: etaSeconds != null ? formatDurationEstimate(etaSeconds) : t("app.embeddingBuild.estimating") })}</span>
            {status.currentLabel && <span title={status.currentLabel}>{t("app.embeddingBuild.current", { label: status.currentLabel })}</span>}
          </div>
        )}
        {isActive && (
          <div className="embedding-build-banner-progress">
            <div className={`model-download-progress-track${showIndeterminateProgress ? " model-download-progress-track--indeterminate" : ""}`} aria-hidden="true">
              <div className="model-download-progress-fill model-download-progress-fill--active" style={{ width: showIndeterminateProgress ? "34%" : `${progressFillPercent}%` }} />
            </div>
          </div>
        )}
      </div>
      <div className="embedding-build-banner-actions">
        {isActive ? (
          <button type="button" className="btn" onClick={() => void handleCancel()} disabled={phase === "cancelling"}>
            {phase === "cancelling" ? t("app.embeddingBuild.cancellingAction") : t("app.embeddingBuild.cancelAction")}
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            {t("common.dismiss")}
          </button>
        )}
      </div>
    </div>
  );
}

export function DocumentProcessingBanner() {
  const { t } = useI18n();
  const { documentProcessingStatus, documentProcessingBannerOpen, dismissDocumentProcessingBanner } = useStore();

  if (!documentProcessingBannerOpen || !documentProcessingStatus) return null;
  const phase = documentProcessingStatus.phase;
  if (phase === "idle") return null;
  const isActive = phase === "running";
  const failures = documentProcessingStatus.failures ?? [];
  const progressPercent = documentProcessingStatus.totalDocuments > 0
    ? (documentProcessingStatus.completedDocuments / documentProcessingStatus.totalDocuments) * 100
    : 0;

  return (
    <div className={`embedding-build-banner embedding-build-banner--${phase}`}>
      <div className="embedding-build-banner-copy">
        <strong>
          {phase === "running" && t("app.documentProcessing.runningTitle")}
          {phase === "completed" && t("app.documentProcessing.completedTitle")}
          {phase === "error" && t("app.documentProcessing.errorTitle")}
        </strong>
        <span>{documentProcessingStatus.message}</span>
        {isActive && documentProcessingStatus.currentChunkIndex && documentProcessingStatus.currentChunkTotal && (
          <span>{t("app.documentProcessing.chunkProgress", { index: documentProcessingStatus.currentChunkIndex, total: documentProcessingStatus.currentChunkTotal })}</span>
        )}
        {failures.length > 0 && (
          <div className="embedding-build-banner-meta embedding-build-banner-meta--stacked">
            {failures.map((failure, index) => (
              <span key={`${failure.documentName}-${index}`}>
                {t("app.documentProcessing.errorLine", { documentName: failure.documentName, message: failure.message })}
              </span>
            ))}
          </div>
        )}
        {isActive && (
          <div className="embedding-build-banner-progress">
            <div className="model-download-progress-track" aria-hidden="true">
              <div className="model-download-progress-fill model-download-progress-fill--active" style={{ width: `${Math.max(6, Math.min(100, progressPercent))}%` }} />
            </div>
          </div>
        )}
      </div>
      <div className="embedding-build-banner-actions">
        {!isActive && (
          <button type="button" className="btn" onClick={dismissDocumentProcessingBanner}>
            {t("common.dismiss")}
          </button>
        )}
      </div>
    </div>
  );
}

export function EmbeddingModelDownloadBanner() {
  const { t, formatNumber } = useI18n();
  const {
    embeddingModelDownloadStatus,
    embeddingModelDownloadPreflight,
    embeddingModelDownloadBannerOpen,
    cancelEmbeddingModelDownload,
    dismissEmbeddingModelDownloadBanner,
  } = useStore();

  if (!embeddingModelDownloadBannerOpen || !embeddingModelDownloadStatus) return null;
  const phase = embeddingModelDownloadStatus.phase;
  if (phase === "idle") return null;
  const isActive = phase === "downloading" || phase === "cancelling";
  const totalBytes = embeddingModelDownloadPreflight?.totalBytes ?? embeddingModelDownloadStatus.totalBytes ?? 0;
  const liveDownloadedBytes = isActive
    ? embeddingModelDownloadStatus.downloadedBytes
    : (embeddingModelDownloadPreflight?.existingBytes ?? embeddingModelDownloadStatus.downloadedBytes);
  const liveRemainingBytes = Math.max(0, totalBytes - liveDownloadedBytes);
  const liveRemainingFiles =
    isActive && embeddingModelDownloadStatus.totalFiles > 0
      ? Math.max(0, embeddingModelDownloadStatus.totalFiles - embeddingModelDownloadStatus.downloadedFiles)
      : embeddingModelDownloadPreflight?.remainingFiles;

  return (
    <div className={`embedding-build-banner embedding-build-banner--${phase}`}>
      <div className="embedding-build-banner-copy">
        <strong>
          {phase === "downloading" && t("app.embeddingDownload.downloadingTitle")}
          {phase === "cancelling" && t("app.embeddingDownload.cancellingTitle")}
          {phase === "completed" && t("app.embeddingDownload.completedTitle")}
          {phase === "cancelled" && t("app.embeddingDownload.cancelledTitle")}
          {phase === "error" && t("app.embeddingDownload.errorTitle")}
        </strong>
        <span>
          {embeddingModelDownloadStatus.message ??
            (embeddingModelDownloadStatus.progressPercent != null
              ? t("app.embeddingDownload.downloadedPercent", { percent: Math.round(embeddingModelDownloadStatus.progressPercent) })
              : t("app.embeddingDownload.preparing"))}
        </span>
        {embeddingModelDownloadStatus.progressPercent != null && (
          <span>{t("app.embeddingDownload.downloadProgress", { percent: Math.round(embeddingModelDownloadStatus.progressPercent) })}</span>
        )}
        {embeddingModelDownloadPreflight && (
          <>
            <span>{t("app.embeddingDownload.totalSize", { size: formatGigabytes(totalBytes) })}</span>
            <span>{t("app.embeddingDownload.alreadyOnDevice", { size: formatGigabytes(liveDownloadedBytes) })}</span>
            <span>{t("app.embeddingDownload.remainingToDownload", { size: formatGigabytes(liveRemainingBytes) })}</span>
            {(embeddingModelDownloadPreflight.manifestAvailable || isActive) && liveRemainingFiles != null && (
              <span>{t("app.embeddingDownload.remainingFileCount", { count: formatNumber(liveRemainingFiles) })}</span>
            )}
          </>
        )}
        {embeddingModelDownloadStatus.currentFile && (
          <span>{t("app.embeddingDownload.currentFile", { name: embeddingModelDownloadStatus.currentFile })}</span>
        )}
        {isActive && (
          <div className="embedding-build-banner-progress">
            <div className="model-download-progress-track" aria-hidden="true">
              <div
                className="model-download-progress-fill model-download-progress-fill--active"
                style={{ width: `${Math.max(6, Math.min(100, embeddingModelDownloadStatus.progressPercent ?? 0))}%` }}
              />
            </div>
          </div>
        )}
      </div>
      <div className="embedding-build-banner-actions">
        {isActive ? (
          <button type="button" className="btn" onClick={() => void cancelEmbeddingModelDownload()}>
            {phase === "cancelling" ? t("app.embeddingDownload.cancellingAction") : t("app.embeddingDownload.cancelAction")}
          </button>
        ) : (
          <button type="button" className="btn" onClick={dismissEmbeddingModelDownloadBanner}>
            {t("common.dismiss")}
          </button>
        )}
      </div>
    </div>
  );
}
