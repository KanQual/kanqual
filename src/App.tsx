import { Component, type ComponentType, type ErrorInfo, type ReactNode, lazy, Suspense, useEffect, useRef, useState } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { StoreProvider, useStore } from "./context/StoreContext";
import { I18nProvider } from "./i18n";
import { useI18n } from "./i18n/provider";
import { APP_SETTINGS_KEY, readAppSettings } from "./lib/appSettings";
import { getAppRuntimeInfo } from "./lib/dataRoot";
import {
  loadProjectBackupBannerIssue,
  OPEN_PROJECT_SETTINGS_MODAL_EVENT,
  PROJECT_BACKUPS_CHANGED_EVENT,
  type ProjectBackupBannerIssue,
} from "./lib/projectBackupBanner";
import { getSmokeTestConfig, updateSmokeTestState } from "./lib/smokeTest";
import { initTheme } from "./theme";
import { Sidebar } from "./components/Sidebar";
import { AuthView } from "./views/Auth_View";
import { useAutomaticProjectBackups } from "./hooks/useAutomaticProjectBackups";
import "./App.css";

function lazyView<T extends ComponentType<unknown>>(loader: () => Promise<{ default: T }>) {
  return lazy(loader);
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

function AppErrorBoundaryWithI18n({ children }: { children: ReactNode }) {
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

const ProjectsViewLazy = lazyView(() => import("./views/Projects_View").then((m) => ({ default: m.ProjectsView })));
const HomeViewLazy = lazyView(() => import("./views/Project_Home_View").then((m) => ({ default: m.HomeView })));
const UsersViewLazy = lazyView(() => import("./views/Project_Users_View").then((m) => ({ default: m.UsersView })));
const CasesViewLazy = lazyView(() => import("./views/Project_Cases_View").then((m) => ({ default: m.CasesView })));
const DocumentsViewLazy = lazyView(() => import("./views/Project_Documents_View").then((m) => ({ default: m.DocumentsView })));
const CodebookViewLazy = lazyView(() => import("./views/Project_Codebook_View").then((m) => ({ default: m.CodebookView })));
const AnnotationsViewLazy = lazyView(() => import("./views/Project_Annotations_View").then((m) => ({ default: m.AnnotationsView })));
const ProjectSettingsViewLazy = lazyView(() => import("./views/Project_Settings_View").then((m) => ({ default: m.ProjectSettingsView })));
const CodeTextViewLazy = lazyView(() => import("./views/Analysis_Code_View").then((m) => ({ default: m.CodeTextView })));
const MemosViewLazy = lazyView(() => import("./views/Analysis_Memos_View").then((m) => ({ default: m.MemosView })));
const AIAssistViewLazy = lazyView(() => import("./views/AIAssist_Home_View").then((m) => ({ default: m.AIAssistView })));
const AIAssistChatViewLazy = lazyView(() => import("./views/AIAssist_Chat_View").then((m) => ({ default: m.AIAssistChatView })));
const AIAssistProcessDocumentsViewLazy = lazyView(() => import("./views/AIAssist_ProcessDocuments_View").then((m) => ({ default: m.AIAssistProcessDocumentsView })));
const AIAssistProcessDocumentsReviewViewLazy = lazyView(() => import("./views/AIAssist_ProcessDocuments_Review_View").then((m) => ({ default: m.AIAssistProcessDocumentsReviewView })));
const AIAssistedCodingViewLazy = lazyView(() => import("./views/AIAssist_Code_View").then((m) => ({ default: m.AIAssistedCodingView })));
const AIAssistAttributeCaseViewLazy = lazyView(() => import("./views/AIAssist_Attributes_View").then((m) => ({ default: m.AIAssistAttributeCaseView })));
const AIAssistAttributeDocumentViewLazy = lazyView(() => import("./views/AIAssist_Attributes_View").then((m) => ({ default: m.AIAssistAttributeDocumentView })));
const AIAnalyzeViewLazy = lazyView(() => import("./views/AIAssist_Analyze_View").then((m) => ({ default: m.AIAnalyzeView })));
const CodeReportsViewLazy = lazyView(() => import("./views/Reports_Annotations_View").then((m) => ({ default: m.CodeReportsView })));
const CodesViewLazy = lazyView(() => import("./views/Reports_Codes_View").then((m) => ({ default: m.CodesView })));
const ReportsUsersViewLazy = lazyView(() => import("./views/Reports_Users_View").then((m) => ({ default: m.ReportsUsersView })));
const ProjectLogViewLazy = lazyView(() => import("./views/Project_Log_View").then((m) => ({ default: m.ProjectLogView })));
const UserSettingsViewLazy = lazyView(() => import("./views/User_Settings_View").then((m) => ({ default: m.UserSettingsView })));
const AppSettingsViewLazy = lazyView(() => import("./views/App_Settings_View").then((m) => ({ default: m.AppSettingsView })));

const VIEW_COMPONENTS = {
  projects: ProjectsViewLazy,
  home: HomeViewLazy,
  users: UsersViewLazy,
  cases: CasesViewLazy,
  documents: DocumentsViewLazy,
  codebook: CodebookViewLazy,
  annotations: AnnotationsViewLazy,
  "project-settings": ProjectSettingsViewLazy,
  "code-text": CodeTextViewLazy,
  memos: MemosViewLazy,
  "ai-assist": AIAssistViewLazy,
  "ai-assist-chat": AIAssistChatViewLazy,
  "ai-assist-process-documents": AIAssistProcessDocumentsViewLazy,
  "ai-assist-process-documents-review": AIAssistProcessDocumentsReviewViewLazy,
  "ai-assisted-coding": AIAssistedCodingViewLazy,
  "ai-assist-case-attributes": AIAssistAttributeCaseViewLazy,
  "ai-assist-document-attributes": AIAssistAttributeDocumentViewLazy,
  "ai-analyze": AIAnalyzeViewLazy,
  "code-reports": CodeReportsViewLazy,
  codes: CodesViewLazy,
  coders: ReportsUsersViewLazy,
  "project-log": ProjectLogViewLazy,
  "user-settings": UserSettingsViewLazy,
  "app-settings": AppSettingsViewLazy,
} as const;

function formatDurationEstimate(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.max(1, Math.round((seconds % 3600) / 60));
  return `${hours} hr ${minutes} min`;
}

function formatGigabytes(value: number): string {
  return `${(value / (1024 ** 3)).toFixed(2)} GB`;
}

function formatPercent(value: number | null): string {
  return value == null ? "--" : `${Math.max(0, Math.min(100, value)).toFixed(0)}%`;
}

type ReleaseCheckResult = {
  latestVersion: string;
  releaseUrl: string;
};

const UPDATE_RELEASES_URL = "https://github.com/KanQual/kanqual/releases";
const UPDATE_DISMISSED_VERSION_KEY = "kq_update_dismissed_version";

function normalizeSemver(version: string): number[] {
  const clean = version.trim().replace(/^v/i, "").split("-")[0];
  const parts = clean.split(".").map((part) => Number.parseInt(part, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function compareSemver(a: string, b: string): number {
  const left = normalizeSemver(a);
  const right = normalizeSemver(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function fetchLatestRelease(): Promise<ReleaseCheckResult | null> {
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

function UpdateAvailableBanner({
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
        <a
          className="btn btn--primary"
          href={releaseUrl}
          target="_blank"
          rel="noreferrer"
        >
          {t("app.updateBanner.viewRelease")}
        </a>
        <button type="button" className="btn" onClick={onDismiss}>
          {t("common.dismiss")}
        </button>
      </div>
    </div>
  );
}

function ProjectBackupBanner() {
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

function ForcePasswordChangeView() {
  const { t } = useI18n();
  const { user, changePassword, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
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
          <p className="auth-hint">
            {t("app.forcePassword.temporaryNotice")}
          </p>
          <p className="auth-hint">
            {t("app.forcePassword.signedInAs", { email: user?.email ?? "" })}
          </p>
          <label className="form-label">
            {t("app.forcePassword.temporaryPassword")}
            <input
              className="form-input"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
            />
          </label>
          <label className="form-label">
            {t("app.forcePassword.newPassword")}
            <input
              className="form-input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="form-label">
            {t("app.forcePassword.confirmPassword")}
            <input
              className="form-input"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
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

function ProjectEmbeddingBuildBanner() {
  const { t } = useI18n();
  const {
    projectEmbeddingBuildStatus,
    projectEmbeddingBuildBannerOpen,
    cancelProjectEmbeddingBuild,
    dismissProjectEmbeddingBanner,
    projects,
    activeProject,
  } = useStore();

  if (!projectEmbeddingBuildBannerOpen || !projectEmbeddingBuildStatus) return null;
  const phase = projectEmbeddingBuildStatus.phase;
  const isActive = phase === "running" || phase === "cancelling";
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
        <span>
          {projectEmbeddingBuildStatus.message ??
            t("app.embeddingBuild.itemsProcessed", {
              completed: projectEmbeddingBuildStatus.completedItems,
              total: projectEmbeddingBuildStatus.totalItems,
            })}
        </span>
        {isActive && (
          <div className="embedding-build-banner-meta">
            {bannerProjectName && <span>{t("app.embeddingBuild.project", { name: bannerProjectName })}</span>}
            <span>{t("app.embeddingBuild.progress", { value: formatPercent(projectEmbeddingBuildStatus.progressPercent) })}</span>
            <span>{t("app.embeddingBuild.items", {
              completed: projectEmbeddingBuildStatus.completedItems,
              total: projectEmbeddingBuildStatus.totalItems,
            })}</span>
            <span>{t("app.embeddingBuild.eta", {
              value: etaSeconds != null ? formatDurationEstimate(etaSeconds) : t("app.embeddingBuild.estimating"),
            })}</span>
            {projectEmbeddingBuildStatus.currentLabel && (
              <span title={projectEmbeddingBuildStatus.currentLabel}>
                {t("app.embeddingBuild.current", { label: projectEmbeddingBuildStatus.currentLabel })}
              </span>
            )}
          </div>
        )}
        {isActive && (
          <div className="embedding-build-banner-progress">
            <div
              className={`model-download-progress-track${showIndeterminateProgress ? " model-download-progress-track--indeterminate" : ""}`}
              aria-hidden="true"
            >
              <div
                className="model-download-progress-fill model-download-progress-fill--active"
                style={{
                  width: showIndeterminateProgress ? "34%" : `${progressFillPercent}%`,
                }}
              />
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

function DocumentProcessingBanner() {
  const { t } = useI18n();
  const {
    documentProcessingStatus,
    documentProcessingBannerOpen,
    dismissDocumentProcessingBanner,
  } = useStore();

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
          <span>
            {t("app.documentProcessing.chunkProgress", {
              index: documentProcessingStatus.currentChunkIndex,
              total: documentProcessingStatus.currentChunkTotal,
            })}
          </span>
        )}
        {failures.length > 0 && (
          <div className="embedding-build-banner-meta embedding-build-banner-meta--stacked">
            {failures.map((failure, index) => (
              <span key={`${failure.documentName}-${index}`}>
                {t("app.documentProcessing.errorLine", {
                  documentName: failure.documentName,
                  message: failure.message,
                })}
              </span>
            ))}
          </div>
        )}
        {isActive && (
          <div className="embedding-build-banner-progress">
            <div className="model-download-progress-track" aria-hidden="true">
              <div
                className="model-download-progress-fill model-download-progress-fill--active"
                style={{ width: `${Math.max(6, Math.min(100, progressPercent))}%` }}
              />
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

function EmbeddingModelDownloadBanner() {
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
            <span>
              {t("app.embeddingDownload.totalSize", { size: formatGigabytes(totalBytes) })}
            </span>
            <span>
              {t("app.embeddingDownload.alreadyOnDevice", { size: formatGigabytes(liveDownloadedBytes) })}
            </span>
            <span>
              {t("app.embeddingDownload.remainingToDownload", { size: formatGigabytes(liveRemainingBytes) })}
            </span>
            {(embeddingModelDownloadPreflight.manifestAvailable || isActive) &&
              liveRemainingFiles != null && (
                <span>
                  {t("app.embeddingDownload.remainingFileCount", { count: formatNumber(liveRemainingFiles) })}
                </span>
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
                style={{
                  width: `${Math.max(
                    6,
                    Math.min(100, embeddingModelDownloadStatus.progressPercent ?? 0),
                  )}%`,
                }}
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

function ViewLoadingFallback() {
  const { t } = useI18n();

  return (
    <div className="view-loading-state" role="status" aria-live="polite">
      <div className="view-loading-card">
        <strong>{t("app.viewLoading.title")}</strong>
        <span>{t("app.viewLoading.detail")}</span>
      </div>
    </div>
  );
}

function SmokeTestAuthRunner() {
  const { status, user, pb, useLocalServer, register } = useAuth();
  const runStartedRef = useRef(false);
  const unmountedRef = useRef(false);
  const pbRef = useRef(pb);

  useEffect(() => {
    pbRef.current = pb;
  }, [pb]);

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  useEffect(() => {
    async function runSmokeAuthFlow() {
      const config = await getSmokeTestConfig();
      if (!config.enabled || runStartedRef.current || status === "loading" || user) return;

      const userName = config.userName?.trim();
      const userEmail = config.userEmail?.trim().toLowerCase();
      const userPassword = config.userPassword ?? "";
      if (!userName || !userEmail || !userPassword) {
        await updateSmokeTestState({
          phase: "failed",
          failure: "Smoke test is missing the temporary local account credentials.",
          success: false,
          appDataDir: config.appDataDir,
          portableMode: config.portableMode,
        });
        runStartedRef.current = true;
        return;
      }

      runStartedRef.current = true;

      try {
        await updateSmokeTestState({
          phase: "starting-local-workspace",
          message: "Launching the local PocketBase workspace.",
          success: false,
          appDataDir: config.appDataDir,
          portableMode: config.portableMode,
        });
        await useLocalServer();
        if (unmountedRef.current) {
          await updateSmokeTestState({
            phase: "runner-unmounted-after-local-start",
            message: "Smoke auth runner unmounted after local startup completed.",
            success: false,
            userEmail,
            appDataDir: config.appDataDir,
            portableMode: config.portableMode,
          });
          return;
        }

        await updateSmokeTestState({
          phase: "runner-after-local-start",
          message: "Smoke auth runner resumed after useLocalServer completed.",
          success: false,
          userEmail,
          appDataDir: config.appDataDir,
          portableMode: config.portableMode,
        });

        let waitIterations = 0;
        while (!pbRef.current && waitIterations < 40) {
          waitIterations += 1;
          await new Promise((resolve) => window.setTimeout(resolve, 100));
        }
        if (!pbRef.current) {
          throw new Error("Local workspace client did not become ready after startup.");
        }
        await updateSmokeTestState({
          phase: "runner-pb-ready-for-register",
          message: `Local workspace client became available after ${waitIterations * 100} ms.`,
          success: false,
          userEmail,
          appDataDir: config.appDataDir,
          portableMode: config.portableMode,
        });

        await updateSmokeTestState({
          phase: "registering-user",
          message: `Creating the first local account for ${userEmail}.`,
          success: false,
          userEmail,
          appDataDir: config.appDataDir,
          portableMode: config.portableMode,
        });
        await updateSmokeTestState({
          phase: "runner-before-register-call",
          message: `Calling register() for ${userEmail}.`,
          success: false,
          userEmail,
          appDataDir: config.appDataDir,
          portableMode: config.portableMode,
        });
        await register(userName, userEmail, userPassword);
        if (unmountedRef.current) {
          return;
        }
        await updateSmokeTestState({
          phase: "runner-register-complete",
          message: `register() completed for ${userEmail}.`,
          success: false,
          userEmail,
          appDataDir: config.appDataDir,
          portableMode: config.portableMode,
        });
      } catch (error) {
        if (unmountedRef.current) return;
        await updateSmokeTestState({
          phase: "failed",
          failure: describeUnknownError(error) || "Smoke auth flow failed.",
          success: false,
          userEmail,
          appDataDir: config.appDataDir,
          portableMode: config.portableMode,
        });
      }
    }

    void runSmokeAuthFlow();
  }, [pb, register, status, useLocalServer, user]);

  return null;
}

function SmokeTestStoreRunner() {
  const { projects, projectsLoading, activeProject, createProject, openProject } = useStore();
  const runStartedRef = useRef(false);
  const unmountedRef = useRef(false);

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  useEffect(() => {
    async function runSmokeProjectFlow() {
      const config = await getSmokeTestConfig();
      if (!config.enabled || runStartedRef.current || projectsLoading) return;

      const projectName = config.projectName?.trim();
      if (!projectName) {
        runStartedRef.current = true;
        await updateSmokeTestState({
          phase: "failed",
          failure: "Smoke test is missing the test project name.",
          success: false,
          userEmail: config.userEmail,
          appDataDir: config.appDataDir,
          portableMode: config.portableMode,
        });
        return;
      }

      if (activeProject?.name === projectName) {
        runStartedRef.current = true;
        await updateSmokeTestState({
          phase: "completed",
          message: `Opened smoke test project "${projectName}".`,
          success: true,
          projectId: activeProject.id,
          userEmail: config.userEmail,
          appDataDir: config.appDataDir,
          portableMode: config.portableMode,
        });
        return;
      }

      try {
        runStartedRef.current = true;
        await updateSmokeTestState({
          phase: "creating-project",
          message: `Creating smoke test project "${projectName}".`,
          success: false,
          userEmail: config.userEmail,
          appDataDir: config.appDataDir,
          portableMode: config.portableMode,
        });

        const existingProject = projects.find((project) => project.name.trim().toLowerCase() === projectName.toLowerCase());
        const project = existingProject ?? await createProject(projectName, "Packaged runtime smoke test project.");
        if (unmountedRef.current) return;

        await openProject(project, activeProject);
        if (unmountedRef.current) return;

        await updateSmokeTestState({
          phase: "completed",
          message: `Created and opened smoke test project "${project.name}".`,
          success: true,
          projectId: project.id,
          userEmail: config.userEmail,
          appDataDir: config.appDataDir,
          portableMode: config.portableMode,
        });
      } catch (error) {
        if (unmountedRef.current) return;
        await updateSmokeTestState({
          phase: "failed",
          failure: describeUnknownError(error) || "Smoke project flow failed.",
          success: false,
          userEmail: config.userEmail,
          appDataDir: config.appDataDir,
          portableMode: config.portableMode,
        });
      }
    }

    void runSmokeProjectFlow();
  }, [activeProject, createProject, openProject, projects, projectsLoading]);

  return null;
}

function AppShell() {
  const { view } = useStore();
  const ActiveView = VIEW_COMPONENTS[view as keyof typeof VIEW_COMPONENTS];
  const [availableUpdate, setAvailableUpdate] = useState<ReleaseCheckResult | null>(null);

  useEffect(() => { initTheme(); }, []);
  useAutomaticProjectBackups();

  useEffect(() => {
    function allowNativeContextMenu(target: EventTarget | null): boolean {
      if (!(target instanceof Element)) return false;

      const editableAncestor = target.closest(
        [
          "input",
          "textarea",
          "select",
          "[contenteditable=\"true\"]",
          "[contenteditable=\"\"]",
          "[role=\"textbox\"]",
        ].join(","),
      );

      if (!editableAncestor) return false;
      if (editableAncestor instanceof HTMLInputElement) {
        return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(
          editableAncestor.type,
        );
      }

      return true;
    }

    function handleContextMenu(event: MouseEvent) {
      if (allowNativeContextMenu(event.target)) return;
      event.preventDefault();
    }

    window.addEventListener("contextmenu", handleContextMenu);
    return () => {
      window.removeEventListener("contextmenu", handleContextMenu);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function checkForAppUpdates() {
      const settings = readAppSettings();
      if (!settings.updates.autoCheck) return;
      try {
        const runtimeInfo = await getAppRuntimeInfo();
        const update = await fetchLatestRelease();
        if (!update) return;
        if (compareSemver(update.latestVersion, runtimeInfo.appVersion) <= 0) return;
        const dismissedVersion = localStorage.getItem(UPDATE_DISMISSED_VERSION_KEY);
        if (dismissedVersion === update.latestVersion) return;
        if (!cancelled) setAvailableUpdate(update);
      } catch (error) {
        console.warn("Update check failed:", describeUnknownError(error));
      }
    }

    void checkForAppUpdates();
    return () => {
      cancelled = true;
    };
  }, []);

  function dismissAvailableUpdate() {
    if (availableUpdate) {
      localStorage.setItem(UPDATE_DISMISSED_VERSION_KEY, availableUpdate.latestVersion);
    }
    setAvailableUpdate(null);
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        {availableUpdate && (
          <UpdateAvailableBanner
            version={availableUpdate.latestVersion}
            releaseUrl={availableUpdate.releaseUrl}
            onDismiss={dismissAvailableUpdate}
          />
        )}
        <ProjectBackupBanner />
        <ProjectEmbeddingBuildBanner />
        <DocumentProcessingBanner />
        <EmbeddingModelDownloadBanner />
        {ActiveView && (
          <Suspense fallback={<ViewLoadingFallback />}>
            <ActiveView />
          </Suspense>
        )}
      </main>
    </div>
  );
}

function AuthGate() {
  const { status, pb, user } = useAuth();

  if (status !== "authenticated" || !pb) {
    return (
      <>
        <SmokeTestAuthRunner />
        <AuthView />
      </>
    );
  }

  if (user?.must_change_password) {
    return <ForcePasswordChangeView />;
  }

  return (
    <StoreProvider pb={pb}>
      <SmokeTestStoreRunner />
      <AppShell />
    </StoreProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <I18nProvider>
        <AppErrorBoundaryWithI18n>
          <AuthGate />
        </AppErrorBoundaryWithI18n>
      </I18nProvider>
    </AuthProvider>
  );
}
