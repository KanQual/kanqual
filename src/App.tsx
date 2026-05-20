import { type ComponentType, lazy, Suspense, useEffect, useRef, useState } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { StoreProvider, useStore } from "./context/StoreContext";
import { getSmokeTestConfig, updateSmokeTestState } from "./lib/smokeTest";
import { initTheme } from "./theme";
import { Sidebar } from "./components/Sidebar";
import { AuthView } from "./views/Auth_View";
import { useAutomaticProjectBackups } from "./hooks/useAutomaticProjectBackups";
import "./App.css";

function lazyView<T extends ComponentType<unknown>>(loader: () => Promise<{ default: T }>) {
  return lazy(loader);
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

function ForcePasswordChangeView() {
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
      setError("Enter the temporary password and the new password twice.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : "Password change failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">Kanqual</div>
        <p className="auth-tagline">Text annotation for qualitative research</p>
        <form onSubmit={handleSubmit} className="form">
          <h2 className="auth-panel-title">Create a New Password</h2>
          <p className="auth-hint">
            This account was created with a temporary password. You must choose a new password before continuing.
          </p>
          <p className="auth-hint">
            Signed in as <strong>{user?.email}</strong>
          </p>
          <label className="form-label">
            Temporary password
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
            New password
            <input
              className="form-input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="form-label">
            Confirm new password
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
              Sign Out
            </button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? "Updating..." : "Set New Password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ProjectEmbeddingBuildBanner() {
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
          {phase === "running" && "Building local embeddings"}
          {phase === "cancelling" && "Cancelling embedding build"}
          {phase === "completed" && "Embedding build complete"}
          {phase === "cancelled" && "Embedding build cancelled"}
          {phase === "error" && "Embedding build failed"}
        </strong>
        <span>
          {projectEmbeddingBuildStatus.message ??
            `${projectEmbeddingBuildStatus.completedItems} of ${projectEmbeddingBuildStatus.totalItems} items processed`}
        </span>
        {isActive && (
          <div className="embedding-build-banner-meta">
            {bannerProjectName && <span>Project: {bannerProjectName}</span>}
            <span>Progress: {formatPercent(projectEmbeddingBuildStatus.progressPercent)}</span>
            <span>
              Items: {projectEmbeddingBuildStatus.completedItems} / {projectEmbeddingBuildStatus.totalItems}
            </span>
            <span>ETA: {etaSeconds != null ? formatDurationEstimate(etaSeconds) : "Estimating..."}</span>
            {projectEmbeddingBuildStatus.currentLabel && (
              <span title={projectEmbeddingBuildStatus.currentLabel}>
                Current: {projectEmbeddingBuildStatus.currentLabel}
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
            {phase === "cancelling" ? "Cancelling..." : "Cancel"}
          </button>
        ) : (
          <button type="button" className="btn" onClick={dismissProjectEmbeddingBanner}>
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

function DocumentProcessingBanner() {
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
          {phase === "running" && "Processing documents"}
          {phase === "completed" && "Document processing complete"}
          {phase === "error" && "Document processing failed"}
        </strong>
        <span>{documentProcessingStatus.message}</span>
        {failures.length > 0 && (
          <div className="embedding-build-banner-meta embedding-build-banner-meta--stacked">
            {failures.map((failure, index) => (
              <span key={`${failure.documentName}-${index}`}>
                Error in {failure.documentName}: {failure.message}
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
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

function EmbeddingModelDownloadBanner() {
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
          {phase === "downloading" && "Downloading embedding model"}
          {phase === "cancelling" && "Cancelling embedding model download"}
          {phase === "completed" && "Embedding model download complete"}
          {phase === "cancelled" && "Embedding model download cancelled"}
          {phase === "error" && "Embedding model download failed"}
        </strong>
        <span>
          {embeddingModelDownloadStatus.message ??
            (embeddingModelDownloadStatus.progressPercent != null
              ? `${Math.round(embeddingModelDownloadStatus.progressPercent)}% downloaded`
              : "Preparing download...")}
        </span>
        {embeddingModelDownloadStatus.progressPercent != null && (
          <span>Download progress: {Math.round(embeddingModelDownloadStatus.progressPercent)}%</span>
        )}
        {embeddingModelDownloadPreflight && (
          <>
            <span>
              Total model size: {formatGigabytes(totalBytes)}
            </span>
            <span>
              Already on device: {formatGigabytes(liveDownloadedBytes)}
            </span>
            <span>
              Remaining to download: {formatGigabytes(liveRemainingBytes)}
            </span>
            {(embeddingModelDownloadPreflight.manifestAvailable || isActive) &&
              liveRemainingFiles != null && (
                <span>
                  Remaining file count: {liveRemainingFiles}
                </span>
              )}
          </>
        )}
        {embeddingModelDownloadStatus.currentFile && (
          <span>Current file: {embeddingModelDownloadStatus.currentFile}</span>
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
            {phase === "cancelling" ? "Cancelling..." : "Cancel"}
          </button>
        ) : (
          <button type="button" className="btn" onClick={dismissEmbeddingModelDownloadBanner}>
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

function ViewLoadingFallback() {
  return (
    <div className="view-loading-state" role="status" aria-live="polite">
      <div className="view-loading-card">
        <strong>Loading view...</strong>
        <span>Preparing the tools and data for this section.</span>
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
          failure: error instanceof Error ? error.message : "Smoke auth flow failed.",
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
          failure: error instanceof Error ? error.message : "Smoke project flow failed.",
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

  useEffect(() => { initTheme(); }, []);
  useAutomaticProjectBackups();

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
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
      <AuthGate />
    </AuthProvider>
  );
}
