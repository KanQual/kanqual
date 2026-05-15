import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { StoreProvider, useStore } from "./context/StoreContext";
import { initTheme } from "./theme";
import { Sidebar } from "./components/Sidebar";
import { AuthView } from "./views/Auth_View";
import { ProjectsView } from "./views/Projects_View";
import { HomeView } from "./views/Project_Home_View";
import { UsersView } from "./views/Project_Users_View";
import { CasesView } from "./views/Project_Cases_View";
import { DocumentsView } from "./views/Project_Documents_View";
import { CodebookView } from "./views/Project_Codebook_View";
import { AnnotationsView } from "./views/Project_Annotations_View";
import { CodeTextView } from "./views/Analysis_Code_View";
import { AIAssistedCodingView } from "./views/AIAssist_Code_View";
import { AIAnalyzeView } from "./views/AIAssist_Analyze_View";
import { AIAssistProcessDocumentsView } from "./views/AIAssist_ProcessDocuments_View";
import { AIAssistProcessDocumentsReviewView } from "./views/AIAssist_ProcessDocuments_Review_View";
import { MemosView } from "./views/Analysis_Memos_View";
import { CodeReportsView } from "./views/Reports_Annotations_View";
import { AIAssistAttributeCaseView, AIAssistAttributeDocumentView } from "./views/AIAssist_Attributes_View";
import { AIAssistView } from "./views/AIAssist_Home_View";
import { AIAssistChatView } from "./views/AIAssist_Chat_View";
import { UserSettingsView } from "./views/User_Settings_View";
import { AppSettingsView } from "./views/App_Settings_View";
import { ProjectLogView } from "./views/Project_Log_View";
import { ProjectSettingsView } from "./views/Project_Settings_View";
import { ReportsUsersView } from "./views/Reports_Users_View";
import { CodesView } from "./views/Reports_Codes_View";
import { useAutomaticProjectBackups } from "./hooks/useAutomaticProjectBackups";
import "./App.css";

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

function AppShell() {
  const { view } = useStore();

  useEffect(() => { initTheme(); }, []);
  useAutomaticProjectBackups();

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        <ProjectEmbeddingBuildBanner />
        <DocumentProcessingBanner />
        <EmbeddingModelDownloadBanner />
{view === "projects"      && <ProjectsView />}
        {view === "home"          && <HomeView />}
        {view === "users"         && <UsersView />}
        {view === "cases"         && <CasesView />}
        {view === "documents"     && <DocumentsView />}
        {view === "codebook"      && <CodebookView />}
        {view === "annotations"   && <AnnotationsView />}
        {view === "project-settings" && <ProjectSettingsView />}
        {view === "code-text"     && <CodeTextView />}
        {view === "memos"         && <MemosView />}
        {view === "ai-assist"     && <AIAssistView />}
        {view === "ai-assist-chat" && <AIAssistChatView />}
        {view === "ai-assist-process-documents" && <AIAssistProcessDocumentsView />}
        {view === "ai-assist-process-documents-review" && <AIAssistProcessDocumentsReviewView />}
        {view === "ai-assisted-coding" && <AIAssistedCodingView />}
        {view === "ai-assist-case-attributes" && <AIAssistAttributeCaseView />}
        {view === "ai-assist-document-attributes" && <AIAssistAttributeDocumentView />}
        {view === "ai-analyze"    && <AIAnalyzeView />}
        {view === "code-reports"  && <CodeReportsView />}
        {view === "codes"         && <CodesView />}
        {view === "coders"        && <ReportsUsersView />}
        {view === "project-log"   && <ProjectLogView />}
        {view === "user-settings" && <UserSettingsView />}
        {view === "app-settings"  && <AppSettingsView />}
      </main>
    </div>
  );
}

function AuthGate() {
  const { status, pb, user } = useAuth();

  if (status !== "authenticated" || !pb) {
    return <AuthView />;
  }

  if (user?.must_change_password) {
    return <ForcePasswordChangeView />;
  }

  return (
    <StoreProvider pb={pb}>
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
