import {
  type ComponentType,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { StoreProvider, useStore } from "./context/StoreContext";
import { I18nProvider } from "./i18n";
import { useI18n } from "./i18n/provider";
import { readAppSettings, saveAppSettings } from "./lib/appSettings";
import { getAppRuntimeInfo } from "./lib/dataRoot";
import {
  bootstrapPostgresExperiment,
  clearPostgresExperimentRememberedAccounts,
  clearPostgresExperimentUserProjectState,
  getPostgresExperimentAuthStatus,
  getPostgresExperimentDeviceState,
  getPostgresExperimentInstallationSettings,
  logoutPostgresExperimentAppUser,
  getPostgresExperimentStatus,
  savePostgresExperimentDeviceState,
  getPostgresExperimentUserPreferences,
  type PostgresExperimentAuthSession,
  type PostgresExperimentAuthStatus,
  type PostgresExperimentInstallationSettings,
  type PostgresExperimentProject,
  type PostgresExperimentStatus,
  type PostgresExperimentUserPreferences,
} from "./lib/postgresExperiment";
import { getSmokeTestConfig, updateSmokeTestState } from "./lib/smokeTest";
import { initTheme, setRuntimeThemePreferences } from "./theme";
import { Sidebar } from "./components/Sidebar";
import { AuthView } from "./views/Auth_View";
import { useAutomaticProjectBackups } from "./hooks/useAutomaticProjectBackups";
import sidebarLogo from "./assets/logo-no-background.png";
import {
  AppErrorBoundaryWithI18n,
  compareSemver,
  DocumentProcessingBanner,
  EmbeddingModelDownloadBanner,
  fetchLatestRelease,
  ForcePasswordChangeView,
  ProjectBackupBanner,
  ProjectEmbeddingBuildBanner,
  type ReleaseCheckResult,
  UpdateAvailableBanner,
} from "./views/App_Shell_Helpers";
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

function syncLegacyAppSettingsFromPostgresInstallationSettings(
  installationSettings: PostgresExperimentInstallationSettings,
): void {
  const current = readAppSettings();
  saveAppSettings({
    ...current,
    startup: {
      ...current.startup,
      reopenLastProject: installationSettings.startupReopenLastProject,
    },
    documentImport: {
      ...current.documentImport,
      defaultMode: installationSettings.documentImportDefaultMode,
      autoNameFromFile: installationSettings.documentImportAutoNameFromFile,
      trimImportedText: installationSettings.documentImportTrimImportedText,
      warnBeforeEmptyImport: installationSettings.documentImportWarnBeforeEmptyImport,
    },
    privacy: {
      ...current.privacy,
      maskFilePaths: installationSettings.privacyMaskFilePaths,
      clearRecentProjectsOnSignOut: installationSettings.privacyClearRecentProjectsOnSignOut,
      forgetLoginIdentitiesOnLogout: installationSettings.privacyForgetLoginIdentitiesOnLogout,
    },
    updates: {
      ...current.updates,
      autoCheck: installationSettings.updatesAutoCheck,
    },
    llm: {
      ...current.llm,
      ...installationSettings.llm,
    },
  });
}

function applyPostgresRuntimeThemePreferences(preferences: PostgresExperimentUserPreferences): void {
  setRuntimeThemePreferences({
    theme: preferences.theme,
    density: preferences.density,
    fontSize: preferences.fontSize,
    themeState: preferences.themeState,
  });
  initTheme();
}

const ProjectsViewLazy = lazyView(() => import("./views/Projects_View").then((m) => ({ default: m.ProjectsView })));
const HomeViewLazy = lazyView(() => import("./views/Project_Home_View").then((m) => ({ default: m.HomeView })));
const UsersViewLazy = lazyView(() => import("./views/Project_Users_View").then((m) => ({ default: m.UsersView })));
const CasesViewLazy = lazyView(() => import("./views/Project_Cases_View").then((m) => ({ default: m.CasesView })));
const DocumentsViewLazy = lazyView(() => import("./views/Project_Documents_View").then((m) => ({ default: m.DocumentsView })));
const PostgresProjectsExperimentViewLazy = lazy(
  () => import("./views/Postgres_Projects_Experiment_View").then((m) => ({ default: m.PostgresProjectsExperimentView })),
);
const PostgresAdminHandoffViewLazy = lazy(
  () => import("./views/Postgres_Experiment_Auth_Flow_Views").then((m) => ({ default: m.PostgresAdminHandoffView })),
);
const PostgresExperimentLaunchViewLazy = lazy(
  () => import("./views/Postgres_Experiment_Auth_Flow_Views").then((m) => ({ default: m.PostgresExperimentLaunchView })),
);
const PostgresExperimentAuthViewLazy = lazy(
  () => import("./views/Postgres_Experiment_Auth_Flow_Views").then((m) => ({ default: m.PostgresExperimentAuthView })),
);
const PostgresProjectHomeExperimentViewLazy = lazy(
  () => import("./views/Postgres_Project_Home_Experiment_View").then((m) => ({ default: m.PostgresProjectHomeExperimentView })),
);
const CodebookViewLazy = lazy(
  () => import("./views/Project_Codebook_View").then((m) => ({
    default: m.CodebookView as ComponentType<import("./views/Project_Codebook_View").CodebookViewProps>,
  })),
);
const AnnotationsViewLazy = lazy(
  () => import("./views/Project_Annotations_View").then((m) => ({
    default: m.AnnotationsView as ComponentType<import("./views/Project_Annotations_View").AnnotationsViewProps>,
  })),
);
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
  "project-log": ProjectLogViewLazy,
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
  coders: ReportsUsersViewLazy,
  codes: CodesViewLazy,
  "user-settings": UserSettingsViewLazy,
  "app-settings": AppSettingsViewLazy,
} as const;

const ENABLE_LEGACY_POCKETBASE_FALLBACK = false;

function PostgresExperimentSidebar({
  activeScreen,
  activeProject,
  authSession,
  onShowProjects,
  onShowProjectHome,
  onShowProjectUsers,
  onShowProjectSources,
  onShowProjectAnnotations,
  onShowProjectCodebook,
  onShowProjectCodeText,
  onShowProjectMemos,
  onShowProjectLog,
  onShowProjectObjects,
  onShowProjectRelationships,
  onShowFreeDraw,
  onShowExplore,
  onShowConstruct,
  onShowCanvasView,
  onShowAppSettings,
  onShowProjectSettings,
  onShowUserSettings,
  onBackToGate,
  onSignOut,
}: {
  activeScreen: "projects" | "home" | "users" | "sources" | "annotations" | "codebook" | "code-text" | "memos" | "project-log" | "objects" | "relationships" | "free-draw" | "explore" | "construct" | "view" | "app-settings" | "project-settings" | "user-settings";
  activeProject: PostgresExperimentProject | null;
  authSession: PostgresExperimentAuthSession;
  onShowProjects?: () => void;
  onShowProjectHome?: () => void;
  onShowProjectUsers?: () => void;
  onShowProjectSources?: () => void;
  onShowProjectAnnotations?: () => void;
  onShowProjectCodebook?: () => void;
  onShowProjectCodeText?: () => void;
  onShowProjectMemos?: () => void;
  onShowProjectLog?: () => void;
  onShowProjectObjects?: () => void;
  onShowProjectRelationships?: () => void;
  onShowFreeDraw?: () => void;
  onShowExplore?: () => void;
  onShowConstruct?: () => void;
  onShowCanvasView?: () => void;
  onShowAppSettings?: () => void;
  onShowProjectSettings?: () => void;
  onShowUserSettings?: () => void;
  onBackToGate: () => void;
  onSignOut: () => Promise<void>;
}) {
  const projectItems = [
    { id: "home", label: "Home", disabled: !activeProject, onClick: onShowProjectHome },
    { id: "users", label: "Users", disabled: !activeProject, onClick: onShowProjectUsers },
    { id: "sources", label: "Sources", disabled: !activeProject, onClick: onShowProjectSources },
    { id: "annotations", label: "Annotations", disabled: !activeProject, onClick: onShowProjectAnnotations },
    { id: "codebook", label: "Codebook", disabled: !activeProject, onClick: onShowProjectCodebook },
    { id: "project-log", label: "Log", disabled: !activeProject, onClick: onShowProjectLog },
    { id: "objects", label: "Objects", disabled: !activeProject, onClick: onShowProjectObjects },
    { id: "relationships", label: "Relationships", disabled: !activeProject, onClick: onShowProjectRelationships },
  ];
  const canvasItems = [
    { id: "free-draw", label: "Free Draw", disabled: !activeProject, onClick: onShowFreeDraw },
    { id: "explore", label: "Explore", disabled: !activeProject, onClick: onShowExplore },
    { id: "construct", label: "Construct", disabled: !activeProject, onClick: onShowConstruct },
    { id: "view", label: "View", disabled: !activeProject, onClick: onShowCanvasView },
  ];
  const analysisItems = [
    { id: "code-text", label: "Code Sources", disabled: !activeProject, onClick: onShowProjectCodeText },
    { id: "memos", label: "Memos", disabled: !activeProject, onClick: onShowProjectMemos },
  ];
  const settingsItems = [
    { id: "app-settings", label: "App Settings", disabled: false, onClick: onShowAppSettings },
    { id: "project-settings", label: "Project Settings", disabled: !activeProject, onClick: onShowProjectSettings },
    { id: "user-settings", label: "User Settings", disabled: false, onClick: onShowUserSettings },
    { id: "projects", label: "Projects", disabled: false, onClick: onShowProjects },
    { id: "experiment", label: "Back to Gate", disabled: false, onClick: onBackToGate },
    { id: "sign-out", label: "Sign Out", disabled: false, onClick: () => void onSignOut() },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img src={sidebarLogo} alt="Kanqual" className="brand-logo" />
      </div>

      {activeProject ? (
        <div className="sidebar-project-badge">
          <span className="project-badge-label">PostgreSQL Project</span>
          <div className="project-badge-row">
            <span className="project-badge-name">{activeProject.name}</span>
          </div>
        </div>
      ) : (
        <button type="button" className="sidebar-project-badge sidebar-project-badge--empty" onClick={onShowProjects}>
          <span className="project-badge-label">PostgreSQL Project</span>
          <span className="project-badge-empty-text">Open Project</span>
        </button>
      )}

      <nav className="sidebar-nav">
        <div className="sidebar-section">
          <button type="button" className="sidebar-section-header" aria-expanded="true">
            <span>Project</span>
            <span className="sidebar-section-chevron">{"\u25be"}</span>
          </button>
          <div className="sidebar-section-items">
            {projectItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${activeScreen === item.id ? "nav-item--active" : ""}`}
                onClick={() => item.onClick?.()}
                disabled={item.disabled}
                title={item.disabled ? "Not wired into the PostgreSQL experiment yet." : undefined}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <button type="button" className="sidebar-section-header" aria-expanded="true">
            <span>Analysis</span>
            <span className="sidebar-section-chevron">{"\u25be"}</span>
          </button>
          <div className="sidebar-section-items">
            {analysisItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${activeScreen === item.id ? "nav-item--active" : ""}`}
                onClick={() => item.onClick?.()}
                disabled={item.disabled}
                title={item.disabled ? "Not wired into the PostgreSQL experiment yet." : undefined}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <button type="button" className="sidebar-section-header" aria-expanded="true">
            <span>Settings</span>
            <span className="sidebar-section-chevron">{"\u25be"}</span>
          </button>
          <div className="sidebar-section-items">
            {settingsItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${activeScreen === item.id ? "nav-item--active" : ""}`}
                onClick={() => item.onClick?.()}
                disabled={item.disabled}
                title={item.disabled ? "Open a PostgreSQL project first." : undefined}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <button type="button" className="sidebar-section-header" aria-expanded="true">
            <span>Canvas</span>
            <span className="sidebar-section-chevron">{"\u25be"}</span>
          </button>
          <div className="sidebar-section-items">
            {canvasItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${activeScreen === item.id ? "nav-item--active" : ""}`}
                onClick={() => item.onClick?.()}
                disabled={item.disabled}
                title={item.disabled ? "Open a PostgreSQL project first." : undefined}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <div className="sidebar-user">
        <div className="sidebar-user-info">
          <div className="sidebar-user-name">{authSession.user.name}</div>
          <div className="sidebar-user-email">{authSession.user.email}</div>
        </div>
      </div>
    </aside>
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
      try {
        const [installationSettings, deviceState] = await Promise.all([
          getPostgresExperimentInstallationSettings(),
          getPostgresExperimentDeviceState(),
        ]);
        if (!installationSettings.updatesAutoCheck) return;
        const runtimeInfo = await getAppRuntimeInfo();
        const update = await fetchLatestRelease();
        if (!update) return;
        if (compareSemver(update.latestVersion, runtimeInfo.appVersion) <= 0) return;
        const dismissedVersion = deviceState.dismissedUpdateVersion;
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

  async function dismissAvailableUpdate() {
    if (availableUpdate) {
      try {
        await savePostgresExperimentDeviceState({
          dismissedUpdateVersion: availableUpdate.latestVersion,
        });
      } catch (error) {
        console.warn("Could not persist dismissed update version:", describeUnknownError(error));
      }
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
  const [postgresStatus, setPostgresStatus] = useState<PostgresExperimentStatus | null>(null);
  const [postgresStatusLoaded, setPostgresStatusLoaded] = useState(false);
  const [postgresAuthStatus, setPostgresAuthStatus] = useState<PostgresExperimentAuthStatus | null>(null);
  const [postgresAuthLoaded, setPostgresAuthLoaded] = useState(false);
  const [postgresInstallationSettings, setPostgresInstallationSettings] = useState<PostgresExperimentInstallationSettings | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPostgresRuntimePreferences() {
      if (!postgresAuthStatus?.currentSession) return;
      try {
        const preferences = await getPostgresExperimentUserPreferences();
        if (!cancelled) {
          applyPostgresRuntimeThemePreferences(preferences);
        }
      } catch (error) {
        console.warn("Could not load PostgreSQL runtime theme preferences:", describeUnknownError(error));
      }
    }

    void loadPostgresRuntimePreferences();
    return () => {
      cancelled = true;
    };
  }, [postgresAuthStatus?.currentSession?.authKind, postgresAuthStatus?.currentSession?.user.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadPostgresExperimentState() {
      try {
        const nextStatus = await getPostgresExperimentStatus();
        if (cancelled) return;

        setPostgresStatus(nextStatus);
        const nextInstallationSettings = nextStatus.bootstrapApplied
          ? await getPostgresExperimentInstallationSettings()
          : null;
        if (!cancelled) {
          setPostgresInstallationSettings(nextInstallationSettings);
          if (nextInstallationSettings) {
            syncLegacyAppSettingsFromPostgresInstallationSettings(nextInstallationSettings);
          }
        }
        if (nextStatus.bootstrapApplied && nextStatus.adminHandoffCompleted) {
          const nextAuthStatus = await getPostgresExperimentAuthStatus();
          if (!cancelled) {
            setPostgresAuthStatus(nextAuthStatus);
          }
        } else if (!cancelled) {
          setPostgresAuthStatus(null);
        }
      } catch (error) {
        console.warn("Failed to load PostgreSQL experiment status:", describeUnknownError(error));
        if (!cancelled) {
          setPostgresAuthStatus(null);
          setPostgresInstallationSettings(null);
        }
      } finally {
        if (!cancelled) {
          setPostgresStatusLoaded(true);
          setPostgresAuthLoaded(true);
        }
      }
    }

    void loadPostgresExperimentState();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshPostgresStatus() {
    setPostgresStatusLoaded(false);
    setPostgresAuthLoaded(false);
    try {
      const nextStatus = await getPostgresExperimentStatus();
      setPostgresStatus(nextStatus);
      const nextInstallationSettings = nextStatus.bootstrapApplied
        ? await getPostgresExperimentInstallationSettings()
        : null;
      setPostgresInstallationSettings(nextInstallationSettings);
      if (nextInstallationSettings) {
        syncLegacyAppSettingsFromPostgresInstallationSettings(nextInstallationSettings);
      }
      if (nextStatus.bootstrapApplied && nextStatus.adminHandoffCompleted) {
        const nextAuthStatus = await getPostgresExperimentAuthStatus();
        setPostgresAuthStatus(nextAuthStatus);
      } else {
        setPostgresAuthStatus(null);
      }
    } catch (error) {
      console.warn("Failed to refresh PostgreSQL experiment status:", describeUnknownError(error));
    } finally {
      setPostgresStatusLoaded(true);
      setPostgresAuthLoaded(true);
    }
  }

  async function handleBootstrapPostgresExperiment(superuserPassword: string) {
    await bootstrapPostgresExperiment(superuserPassword);
    await refreshPostgresStatus();
  }

  const requiresPostgresAdminHandoff = !!(
    postgresStatusLoaded
    && postgresStatus
    && postgresStatus.bootstrapApplied
    && !postgresStatus.adminHandoffCompleted
  );
  const postgresAuthReady = !!(
    postgresStatusLoaded
    && postgresStatus
    && postgresStatus.bootstrapApplied
    && postgresStatus.adminHandoffCompleted
  );

  if (requiresPostgresAdminHandoff && postgresStatus) {
    return (
      <Suspense fallback={<ViewLoadingFallback />}>
        <PostgresAdminHandoffViewLazy
          status={postgresStatus}
          onComplete={async (nextStatus) => {
            setPostgresStatus(nextStatus);
            await refreshPostgresStatus();
          }}
        />
      </Suspense>
    );
  }

  if (!postgresStatusLoaded || (postgresAuthReady && !postgresAuthLoaded)) {
    return (
      <div className="auth-screen">
        <div className="auth-card auth-card--startup">
          <div className="auth-brand">Kanqual</div>
          <p className="auth-tagline">PostgreSQL Experiment</p>
          <p className="auth-starting">
            {postgresAuthReady
              ? "Checking PostgreSQL sign-in status..."
              : "Checking local PostgreSQL experiment status..."}
          </p>
        </div>
      </div>
    );
  }

  const signOutPostgresSession = async () => {
    const nextAuthStatus = await logoutPostgresExperimentAppUser();
    if (postgresInstallationSettings?.privacyForgetLoginIdentitiesOnLogout) {
      await clearPostgresExperimentRememberedAccounts();
    }
    if (postgresInstallationSettings?.privacyClearRecentProjectsOnSignOut) {
      await clearPostgresExperimentUserProjectState();
    }
    setPostgresAuthStatus(nextAuthStatus);
  };

  const clearPostgresAuthSession = () => {
    setPostgresAuthStatus((current) => current
      ? {
          ...current,
          currentSession: null,
        }
      : current);
  };

  if (postgresAuthReady && postgresAuthStatus?.currentSession) {
    return (
      <Suspense fallback={<ViewLoadingFallback />}>
        <PostgresProjectsExperimentViewLazy
          authSession={postgresAuthStatus.currentSession}
          onBack={() => undefined}
          onSignOut={signOutPostgresSession}
          renderSidebar={({ openSelectedProject, authSession, onBack, onSignOut }) => (
            <PostgresExperimentSidebar
              activeScreen="projects"
              activeProject={null}
              authSession={authSession}
              onShowProjects={() => undefined}
              onShowProjectHome={openSelectedProject}
              onShowProjectUsers={openSelectedProject}
              onBackToGate={onBack}
              onSignOut={onSignOut}
            />
          )}
          renderProjectHome={(openedProject, helpers) => (
            <Suspense fallback={<ViewLoadingFallback />}>
              <PostgresProjectHomeExperimentViewLazy
                project={openedProject}
                authSession={postgresAuthStatus.currentSession!}
                onAuthSessionUpdated={(session) => {
                  setPostgresAuthStatus((current) => current
                    ? {
                        ...current,
                        currentSession: session,
                      }
                    : {
                        bootstrapApplied: true,
                        adminHandoffCompleted: true,
                        ready: true,
                        registeredUserCount: 0,
                        localAdminName: "postgres",
                        requiresAccountSetup: false,
                        currentSession: session,
                      });
                }}
                onAuthSessionInvalidated={clearPostgresAuthSession}
                onBack={helpers.onBack}
                onProjectUpdated={helpers.onProjectUpdated}
                onProjectDeleted={helpers.onProjectDeleted}
                onSignOut={signOutPostgresSession}
              />
            </Suspense>
          )}
        />
      </Suspense>
    );
  }

  if (postgresAuthReady) {
    return (
      <Suspense fallback={<ViewLoadingFallback />}>
        <PostgresExperimentAuthViewLazy
          authStatus={postgresAuthStatus}
          onRefresh={refreshPostgresStatus}
          onAuthenticated={(session) => {
            setPostgresAuthStatus((current) => current
              ? {
                  ...current,
                  currentSession: session,
                  requiresAccountSetup: false,
                }
              : {
                  bootstrapApplied: true,
                  adminHandoffCompleted: true,
                  ready: true,
                  registeredUserCount: 0,
                  localAdminName: "postgres",
                  requiresAccountSetup: false,
                  currentSession: session,
                });
          }}
        />
      </Suspense>
    );
  }

  if (ENABLE_LEGACY_POCKETBASE_FALLBACK) {
    return <LegacyPocketBaseWorkspace />;
  }

  return (
    <Suspense fallback={<ViewLoadingFallback />}>
      <PostgresExperimentLaunchViewLazy
        status={postgresStatus}
        loading={!postgresStatusLoaded}
        onRefresh={() => {
          void refreshPostgresStatus();
        }}
        onBootstrap={handleBootstrapPostgresExperiment}
        onOpenPostgresProjects={() => {
          void refreshPostgresStatus();
        }}
      />
    </Suspense>
  );
}

function LegacyPocketBaseWorkspace() {
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





