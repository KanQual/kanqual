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
import { useI18n } from "../i18n/provider";
import { APP_SETTINGS_KEY } from "../lib/appSettings";
import {
  cancelPostgresEmbeddingModelDownload,
  downloadPostgresCustomEmbeddingModel,
  downloadPostgresEmbeddingModel,
  getPostgresEmbeddingModelDownloadStatus,
  cancelPostgresProjectEmbeddingStoreBuild,
  type PostgresEmbeddingModelDownloadStatus,
  type PostgresProject,
  type PostgresProjectChangeEvent,
  POSTGRES_PROJECT_CHANGED_EVENT,
} from "../lib/postgres";
import type { ProjectEmbeddingBuildStatus } from "../lib/projectEmbeddings";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  CloseIcon,
} from "../components/AppIcons";
import {
  clearProjectBackupBannerIssue,
  OPEN_PROJECT_SETTINGS_MODAL_EVENT,
  PROJECT_BACKUPS_CHANGED_EVENT,
  readPendingProjectBackupAttempt,
  readProjectBackupBannerIssue,
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

export const POSTGRES_EMBEDDING_MODEL_DOWNLOAD_CHANGED_EVENT = "kanqual:postgres-embedding-model-download-changed";

type PostgresEmbeddingModelRetryRequest =
  | { kind: "default" }
  | { kind: "custom"; modelUrl: string };

type PostgresEmbeddingModelDownloadChangedDetail = {
  status?: PostgresEmbeddingModelDownloadStatus;
  retry?: PostgresEmbeddingModelRetryRequest;
};

let latestEmbeddingModelDownloadDetail: PostgresEmbeddingModelDownloadChangedDetail | null = null;
let dismissedEmbeddingModelDownloadStatusKey: string | null = null;
let dismissedEmbeddingModelDownloadTerminalPhase: PostgresEmbeddingModelDownloadStatus["phase"] | null = null;
const dismissedProjectEmbeddingBuildStatusKeys = new Set<string>();

export function notifyPostgresEmbeddingModelDownloadChanged(
  detail?: PostgresEmbeddingModelDownloadChangedDetail,
) {
  latestEmbeddingModelDownloadDetail = detail ?? null;
  window.dispatchEvent(new CustomEvent(POSTGRES_EMBEDDING_MODEL_DOWNLOAD_CHANGED_EVENT, { detail }));
}

function getEmbeddingModelDownloadStatusKey(status: PostgresEmbeddingModelDownloadStatus): string {
  return [
    status.phase,
    status.downloadedBytes ?? 0,
    status.totalBytes ?? "",
    status.downloadedFiles ?? 0,
    status.totalFiles ?? 0,
    status.currentFile ?? "",
    status.message ?? "",
  ].join("|");
}

function isTerminalEmbeddingModelDownloadPhase(phase: PostgresEmbeddingModelDownloadStatus["phase"]): boolean {
  return phase === "completed" || phase === "cancelled" || phase === "error";
}

function getProjectEmbeddingBuildStatusKey(status: ProjectEmbeddingBuildStatus): string {
  return [
    status.phase,
    status.projectId ?? "",
    status.completedItems ?? 0,
    status.totalItems ?? 0,
    status.progressPercent ?? "",
    status.message ?? "",
  ].join("|");
}

function isTerminalProjectEmbeddingBuildPhase(phase: ProjectEmbeddingBuildStatus["phase"]): boolean {
  return phase === "completed" || phase === "cancelled" || phase === "error";
}

function clearDismissedEmbeddingModelDownloadStatus() {
  dismissedEmbeddingModelDownloadStatusKey = null;
  dismissedEmbeddingModelDownloadTerminalPhase = null;
}

function dismissEmbeddingModelDownloadStatus(status: PostgresEmbeddingModelDownloadStatus) {
  dismissedEmbeddingModelDownloadStatusKey = getEmbeddingModelDownloadStatusKey(status);
  dismissedEmbeddingModelDownloadTerminalPhase = isTerminalEmbeddingModelDownloadPhase(status.phase) ? status.phase : null;
}

function isEmbeddingModelDownloadStatusDismissed(status: PostgresEmbeddingModelDownloadStatus) {
  return (
    dismissedEmbeddingModelDownloadStatusKey === getEmbeddingModelDownloadStatusKey(status)
    || dismissedEmbeddingModelDownloadTerminalPhase === status.phase
  );
}

export type ReleaseCheckResult = {
  latestVersion: string;
  releaseUrl: string;
};

export type PostgresDocumentProcessingBannerStatus = {
  phase: "idle" | "running" | "completed" | "error";
  projectId: string | null;
  completedDocuments: number;
  totalDocuments: number;
  currentDocumentName: string;
  message: string;
  failures: Array<{ documentName: string; message: string }>;
  currentChunkIndex?: number;
  currentChunkTotal?: number;
  error?: string;
};

export const POSTGRES_DOCUMENT_PROCESSING_CHANGED_EVENT = "kanqual:postgres-document-processing-changed";

let latestDocumentProcessingStatus: PostgresDocumentProcessingBannerStatus | null = null;

export function notifyPostgresDocumentProcessingChanged(status: PostgresDocumentProcessingBannerStatus) {
  latestDocumentProcessingStatus = status;
  window.dispatchEvent(new CustomEvent(POSTGRES_DOCUMENT_PROCESSING_CHANGED_EVENT, { detail: status }));
}

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
      <button
        type="button"
        className="embedding-build-banner-close"
        onClick={onDismiss}
        aria-label={t("common.dismiss")}
        title={t("common.dismiss")}
      >
        <CloseIcon className="embedding-build-banner-close-icon" />
      </button>
      <div className="embedding-build-banner-copy">
        <strong>{t("app.updateBanner.title")}</strong>
        <span>{t("app.updateBanner.versionBody", { version })}</span>
        <span>{t("app.updateBanner.detail")}</span>
      </div>
      <div className="embedding-build-banner-actions">
        <a className="btn btn--primary" href={releaseUrl} target="_blank" rel="noreferrer">
          {t("app.updateBanner.viewRelease")}
        </a>
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
    const nextIsTerminal = isTerminalProjectEmbeddingBuildPhase(nextStatus.phase);
    const statusKey = getProjectEmbeddingBuildStatusKey(nextStatus);

    setStatus(nextStatus);
    previousPhaseRef.current = nextStatus.phase;

    if (nextIsActive) {
      dismissedProjectEmbeddingBuildStatusKeys.clear();
    }

    if (nextIsActive || previousWasActive || nextIsTerminal) {
      setOpen(nextStatus.phase !== "idle" && (!nextIsTerminal || !dismissedProjectEmbeddingBuildStatusKeys.has(statusKey)));
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
    }, isActive || !open ? 1000 : 5000);

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
      <button
        type="button"
        className="embedding-build-banner-close"
        onClick={() => {
          if (status && isTerminalProjectEmbeddingBuildPhase(status.phase)) {
            dismissedProjectEmbeddingBuildStatusKeys.add(getProjectEmbeddingBuildStatusKey(status));
          }
          setOpen(false);
        }}
        aria-label={t("common.dismiss")}
        title={t("common.dismiss")}
      >
        <CloseIcon className="embedding-build-banner-close-icon" />
      </button>
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
        ) : null}
      </div>
    </div>
  );
}

export function PostgresProjectSnapshotWarningBanner({
  activeProject,
}: {
  activeProject: PostgresProject | null;
}) {
  const [issue, setIssue] = useState<ProjectBackupBannerIssue | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refreshSnapshotBanner() {
      if (!activeProject) {
        if (!cancelled) setIssue(null);
        return;
      }

      const storedIssue = readProjectBackupBannerIssue(activeProject.id);
      if (storedIssue && (storedIssue.kind === "failed" || storedIssue.kind === "interrupted")) {
        if (!cancelled) setIssue(storedIssue);
        return;
      }

      if (readPendingProjectBackupAttempt(activeProject.id)) {
        if (!cancelled) setIssue(null);
        return;
      }

      if (!cancelled) setIssue(null);
    }

    void refreshSnapshotBanner();

    function handleBackupsChanged(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail as { projectId?: string } | undefined : undefined;
      if (detail?.projectId && activeProject && detail.projectId !== activeProject.id) return;
      void refreshSnapshotBanner();
    }

    window.addEventListener(PROJECT_BACKUPS_CHANGED_EVENT, handleBackupsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(PROJECT_BACKUPS_CHANGED_EVENT, handleBackupsChanged);
    };
  }, [activeProject?.id]);

  if (!activeProject || !issue) return null;

  const activeProjectId = activeProject.id;
  const toneClass = issue.kind === "failed" ? "embedding-build-banner--error" : "embedding-build-banner--warning";
  const title =
    issue.kind === "failed"
      ? "Project snapshot failed"
      : "Project snapshot interrupted";
  const detail =
    issue.kind === "failed"
      ? "Review project snapshots and create a fresh snapshot when possible."
      : "Review project snapshots and create a fresh snapshot if needed.";

  function openSnapshotSettings() {
    sessionStorage.setItem("kanqual:open-project-settings-modal", "backups");
    window.dispatchEvent(new CustomEvent(OPEN_PROJECT_SETTINGS_MODAL_EVENT));
  }

  function dismissSnapshotWarning() {
    clearProjectBackupBannerIssue(activeProjectId);
    setIssue(null);
  }

  return (
    <div className={`embedding-build-banner ${toneClass}`}>
      <button
        type="button"
        className="embedding-build-banner-close"
        onClick={dismissSnapshotWarning}
        aria-label="Dismiss"
        title="Dismiss"
      >
        <CloseIcon className="embedding-build-banner-close-icon" />
      </button>
      <div className="embedding-build-banner-copy">
        <strong>{title}</strong>
        <span>{issue.message}</span>
        <span>{detail}</span>
      </div>
      <div className="embedding-build-banner-actions">
        <button type="button" className="btn btn--primary" onClick={openSnapshotSettings}>
          Snapshots
        </button>
      </div>
    </div>
  );
}

export function PostgresEmbeddingModelDownloadBanner() {
  const { t, formatNumber } = useI18n();
  const [status, setStatus] = useState<PostgresEmbeddingModelDownloadStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [retryRequest, setRetryRequest] = useState<PostgresEmbeddingModelRetryRequest | null>(null);
  const previousPhaseRef = useRef<PostgresEmbeddingModelDownloadStatus["phase"] | null>(null);
  const staleTerminalStatusKeyRef = useRef<string | null>(null);
  const cancelRequestedRef = useRef(false);
  const phase = status?.phase ?? "idle";
  const isActive = phase === "downloading" || phase === "cancelling";

  function applyNextStatus(
    nextStatus: PostgresEmbeddingModelDownloadStatus,
    options: { fromEvent?: boolean } = {},
  ) {
    const previousPhase = previousPhaseRef.current;
    const incomingIsActive = nextStatus.phase === "downloading" || nextStatus.phase === "cancelling";
    const incomingIsTerminal = isTerminalEmbeddingModelDownloadPhase(nextStatus.phase);
    const incomingStatusKey = getEmbeddingModelDownloadStatusKey(nextStatus);

    if (options.fromEvent) {
      if (incomingIsActive) {
        clearDismissedEmbeddingModelDownloadStatus();
      }
      if (incomingIsActive && status && isTerminalEmbeddingModelDownloadPhase(status.phase)) {
        staleTerminalStatusKeyRef.current = getEmbeddingModelDownloadStatusKey(status);
      }
    }

    if (
      incomingIsTerminal
      && staleTerminalStatusKeyRef.current === incomingStatusKey
      && previousPhase !== null
      && (previousPhase === "downloading" || previousPhase === "cancelling")
    ) {
      return;
    }

    const normalizedStatus = cancelRequestedRef.current && nextStatus.phase === "downloading"
      ? {
          ...nextStatus,
          phase: "cancelling" as const,
          message: nextStatus.message ?? "Cancelling download...",
        }
      : nextStatus;
    const nextIsActive = normalizedStatus.phase === "downloading" || normalizedStatus.phase === "cancelling";
    const previousWasActive = previousPhase === "downloading" || previousPhase === "cancelling";
    const nextIsTerminal = isTerminalEmbeddingModelDownloadPhase(normalizedStatus.phase);

    if (nextIsActive) {
      clearDismissedEmbeddingModelDownloadStatus();
      if (!options.fromEvent) {
        staleTerminalStatusKeyRef.current = null;
      }
    }
    if (nextIsTerminal) {
      latestEmbeddingModelDownloadDetail = null;
      staleTerminalStatusKeyRef.current = null;
      cancelRequestedRef.current = false;
    }

    setStatus(normalizedStatus);
    previousPhaseRef.current = normalizedStatus.phase;

    if (
      nextIsActive
      || previousWasActive
      || nextIsTerminal
    ) {
      setOpen(
        normalizedStatus.phase !== "idle"
          && !isEmbeddingModelDownloadStatusDismissed(normalizedStatus),
      );
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function refreshStatus() {
      try {
        const nextStatus = await getPostgresEmbeddingModelDownloadStatus();
        if (cancelled) return;
        applyNextStatus(nextStatus);
      } catch (error) {
        console.warn("Could not load PostgreSQL embedding model download status:", describeUnknownError(error));
      }
    }

    if (latestEmbeddingModelDownloadDetail?.retry) {
      setRetryRequest(latestEmbeddingModelDownloadDetail.retry);
    }
    if (latestEmbeddingModelDownloadDetail?.status) {
      applyNextStatus(latestEmbeddingModelDownloadDetail.status, { fromEvent: true });
    }
    void refreshStatus();
    const intervalId = window.setInterval(() => {
      void refreshStatus();
    }, isActive || !open ? 1000 : 5000);

    function handleChanged(event: Event) {
      const detail = (event as CustomEvent<PostgresEmbeddingModelDownloadChangedDetail>).detail;
      if (detail?.retry) {
        setRetryRequest(detail.retry);
      }
      if (detail?.status) {
        applyNextStatus(detail.status, { fromEvent: true });
        return;
      }
      void refreshStatus();
      window.setTimeout(() => {
        void refreshStatus();
      }, 250);
    }

    window.addEventListener(POSTGRES_EMBEDDING_MODEL_DOWNLOAD_CHANGED_EVENT, handleChanged);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener(POSTGRES_EMBEDDING_MODEL_DOWNLOAD_CHANGED_EVENT, handleChanged);
    };
  }, [isActive, open]);

  if (!open || !status || phase === "idle") return null;

  const progressPercent = Math.max(0, Math.min(100, status.progressPercent ?? 0));
  const progressFillPercent = isActive ? Math.max(8, progressPercent) : progressPercent;
  const showIndeterminateProgress = isActive && progressPercent <= 0;
  const downloadedBytes = status.downloadedBytes ?? 0;
  const totalBytes = status.totalBytes ?? 0;
  const remainingBytes = totalBytes > 0 ? Math.max(0, totalBytes - downloadedBytes) : 0;
  const remainingFiles =
    isActive && status.totalFiles > 0
      ? Math.max(0, status.totalFiles - status.downloadedFiles)
      : null;

  async function handleCancel() {
    cancelRequestedRef.current = true;
    try {
      const nextStatus = await cancelPostgresEmbeddingModelDownload();
      applyNextStatus(nextStatus);
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

  async function handleRetry() {
    if (!retryRequest || isActive) return;
    clearDismissedEmbeddingModelDownloadStatus();
    cancelRequestedRef.current = false;
    const preparingStatus: PostgresEmbeddingModelDownloadStatus = {
      phase: "downloading",
      downloadedBytes: 0,
      totalBytes: null,
      downloadedFiles: 0,
      totalFiles: 0,
      currentFile: null,
      progressPercent: null,
      message: retryRequest.kind === "custom"
        ? `Preparing download from ${retryRequest.modelUrl}...`
        : "Preparing download...",
    };
    applyNextStatus(preparingStatus);
    try {
      if (retryRequest.kind === "custom") {
        await downloadPostgresCustomEmbeddingModel(retryRequest.modelUrl);
      } else {
        await downloadPostgresEmbeddingModel();
      }
      const nextStatus = await getPostgresEmbeddingModelDownloadStatus();
      applyNextStatus(nextStatus);
    } catch (error) {
      const nextStatus = await getPostgresEmbeddingModelDownloadStatus().catch(() => null);
      applyNextStatus(nextStatus && nextStatus.phase !== "idle" ? nextStatus : {
        ...preparingStatus,
        phase: "error",
        message: describeUnknownError(error),
      });
    }
  }

  return (
    <div className={`embedding-build-banner embedding-build-banner--${phase}`}>
      <button
        type="button"
        className="embedding-build-banner-close"
        onClick={() => {
          if (status) {
            dismissEmbeddingModelDownloadStatus(status);
          }
          latestEmbeddingModelDownloadDetail = null;
          setOpen(false);
        }}
        aria-label={t("common.dismiss")}
        title={t("common.dismiss")}
      >
        <CloseIcon className="embedding-build-banner-close-icon" />
      </button>
      <div className="embedding-build-banner-copy">
        <strong>
          {phase === "downloading" && t("app.embeddingDownload.downloadingTitle")}
          {phase === "cancelling" && t("app.embeddingDownload.cancellingTitle")}
          {phase === "completed" && t("app.embeddingDownload.completedTitle")}
          {phase === "cancelled" && t("app.embeddingDownload.cancelledTitle")}
          {phase === "error" && t("app.embeddingDownload.errorTitle")}
        </strong>
        <span>
          {status.message ??
            (status.progressPercent != null
              ? t("app.embeddingDownload.downloadedPercent", { percent: Math.round(status.progressPercent) })
              : t("app.embeddingDownload.preparing"))}
        </span>
        {status.progressPercent != null ? (
          <span>{t("app.embeddingDownload.downloadProgress", { percent: Math.round(status.progressPercent) })}</span>
        ) : null}
        {totalBytes > 0 ? (
          <>
            <span>{t("app.embeddingDownload.totalSize", { size: formatGigabytes(totalBytes) })}</span>
            <span>{t("app.embeddingDownload.alreadyOnDevice", { size: formatGigabytes(downloadedBytes) })}</span>
            <span>{t("app.embeddingDownload.remainingToDownload", { size: formatGigabytes(remainingBytes) })}</span>
          </>
        ) : null}
        {remainingFiles != null ? (
          <span>{t("app.embeddingDownload.remainingFileCount", { count: formatNumber(remainingFiles) })}</span>
        ) : null}
        {status.currentFile ? (
          <span>{t("app.embeddingDownload.currentFile", { name: status.currentFile })}</span>
        ) : null}
        {isActive ? (
          <div className="embedding-build-banner-progress">
            <div className={`model-download-progress-track${showIndeterminateProgress ? " model-download-progress-track--indeterminate" : ""}`} aria-hidden="true">
              <div className="model-download-progress-fill model-download-progress-fill--active" style={{ width: showIndeterminateProgress ? "34%" : `${progressFillPercent}%` }} />
            </div>
          </div>
        ) : null}
      </div>
      <div className="embedding-build-banner-actions">
        {isActive ? (
          <button type="button" className="btn" onClick={() => void handleCancel()} disabled={phase === "cancelling"}>
            {phase === "cancelling" ? t("app.embeddingDownload.cancellingAction") : t("app.embeddingDownload.cancelAction")}
          </button>
        ) : phase === "error" && retryRequest ? (
          <button type="button" className="btn btn--primary" onClick={() => void handleRetry()}>
            Retry
          </button>
        ) : (
          null
        )}
      </div>
    </div>
  );
}

export function PostgresDocumentProcessingBanner() {
  const { t } = useI18n();
  const [status, setStatus] = useState<PostgresDocumentProcessingBannerStatus | null>(latestDocumentProcessingStatus);
  const [open, setOpen] = useState(Boolean(latestDocumentProcessingStatus && latestDocumentProcessingStatus.phase !== "idle"));

  useEffect(() => {
    function handleChanged(event: Event) {
      const nextStatus = (event as CustomEvent<PostgresDocumentProcessingBannerStatus>).detail;
      latestDocumentProcessingStatus = nextStatus;
      setStatus(nextStatus);
      setOpen(nextStatus.phase !== "idle");
    }

    window.addEventListener(POSTGRES_DOCUMENT_PROCESSING_CHANGED_EVENT, handleChanged);
    return () => {
      window.removeEventListener(POSTGRES_DOCUMENT_PROCESSING_CHANGED_EVENT, handleChanged);
    };
  }, []);

  if (!open || !status) return null;
  const phase = status.phase;
  if (phase === "idle") return null;
  const isActive = phase === "running";
  const failures = status.failures ?? [];
  const progressPercent = status.totalDocuments > 0
    ? (status.completedDocuments / status.totalDocuments) * 100
    : 0;

  return (
    <div className={`embedding-build-banner embedding-build-banner--${phase}`}>
      <button
        type="button"
        className="embedding-build-banner-close"
        onClick={() => setOpen(false)}
        aria-label={t("common.dismiss")}
        title={t("common.dismiss")}
      >
        <CloseIcon className="embedding-build-banner-close-icon" />
      </button>
      <div className="embedding-build-banner-copy">
        <strong>
          {phase === "running" && t("app.documentProcessing.runningTitle")}
          {phase === "completed" && t("app.documentProcessing.completedTitle")}
          {phase === "error" && t("app.documentProcessing.errorTitle")}
        </strong>
        <span>{status.message}</span>
        {isActive && status.currentChunkIndex && status.currentChunkTotal && (
          <span>{t("app.documentProcessing.chunkProgress", { index: status.currentChunkIndex, total: status.currentChunkTotal })}</span>
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
      <div className="embedding-build-banner-actions" />
    </div>
  );
}
