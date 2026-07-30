import {
  lazy,
  Suspense,
  useEffect,
  useState,
} from "react";
import { AuthProvider } from "./context/AuthContext";
import { I18nProvider } from "./i18n";
import { useI18n } from "./i18n/provider";
import { readAppSettings, saveAppSettings } from "./lib/appSettings";
import {
  bootstrapPostgresExperiment,
  clearPostgresExperimentRememberedAccounts,
  clearPostgresExperimentUserProjectState,
  getPostgresExperimentAuthStatus,
  getPostgresExperimentInstallationSettings,
  logoutPostgresExperimentAppUser,
  getPostgresExperimentStatus,
  getPostgresExperimentUserPreferences,
  type PostgresExperimentAuthSession,
  type PostgresExperimentAuthStatus,
  type PostgresExperimentInstallationSettings,
  type PostgresExperimentProject,
  type PostgresExperimentStatus,
  type PostgresExperimentUserPreferences,
} from "./lib/postgresExperiment";
import { initTheme, setRuntimeThemePreferences } from "./theme";
import sidebarMarkLogo from "./assets/logo-mark-no-background.png";
import sidebarLogo from "./assets/logo-no-background.png";
import {
  AppErrorBoundaryWithI18n,
} from "./views/App_Shell_Helpers";
import "./App.css";

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
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const projectItems = [
    { id: "home", label: "Home", disabled: !activeProject, onClick: onShowProjectHome },
    { id: "users", label: "Users", disabled: !activeProject, onClick: onShowProjectUsers },
    { id: "sources", label: "Sources", disabled: !activeProject, onClick: onShowProjectSources },
    { id: "objects", label: "Objects", disabled: !activeProject, onClick: onShowProjectObjects },
    { id: "relationships", label: "Relationships", disabled: !activeProject, onClick: onShowProjectRelationships },
    { id: "codebook", label: "Codebook", disabled: !activeProject, onClick: onShowProjectCodebook },
    { id: "annotations", label: "Annotations", disabled: !activeProject, onClick: onShowProjectAnnotations },
    { id: "project-log", label: "Log", disabled: !activeProject, onClick: onShowProjectLog },
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
    <aside
      className={`sidebar ${sidebarExpanded ? "sidebar--expanded" : ""}`}
      onMouseEnter={() => setSidebarExpanded(true)}
      onMouseLeave={() => setSidebarExpanded(false)}
    >
      <div className="sidebar-brand">
        <img src={sidebarLogo} alt="Kanqual" className="brand-logo" />
        <div className="brand-collapsed-lockup" aria-hidden="true">
          <img src={sidebarMarkLogo} alt="" className="brand-collapsed-logo" />
          <span className="brand-collapsed-title">Kanqual</span>
        </div>
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

function ProjectHomeLoadingShell(props: {
  project: PostgresExperimentProject;
  authSession: PostgresExperimentAuthSession;
  onBack: () => void;
  onSignOut: () => Promise<void>;
}) {
  const { project, authSession, onBack, onSignOut } = props;

  return (
    <div className="app-shell">
      <PostgresExperimentSidebar
        activeScreen="home"
        activeProject={project}
        authSession={authSession}
        onShowProjects={onBack}
        onShowProjectHome={() => undefined}
        onShowProjectUsers={() => undefined}
        onShowProjectSources={() => undefined}
        onShowProjectAnnotations={() => undefined}
        onShowProjectCodebook={() => undefined}
        onShowProjectCodeText={() => undefined}
        onShowProjectMemos={() => undefined}
        onShowProjectLog={() => undefined}
        onShowProjectObjects={() => undefined}
        onShowProjectRelationships={() => undefined}
        onShowFreeDraw={() => undefined}
        onShowExplore={() => undefined}
        onShowConstruct={() => undefined}
        onShowCanvasView={() => undefined}
        onShowAppSettings={() => undefined}
        onShowProjectSettings={() => undefined}
        onShowUserSettings={() => undefined}
        onBackToGate={onBack}
        onSignOut={onSignOut}
      />
      <main className="app-main">
        <ViewLoadingFallback />
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
            <Suspense
              fallback={(
                <ProjectHomeLoadingShell
                  project={openedProject}
                  authSession={postgresAuthStatus.currentSession!}
                  onBack={helpers.onBack}
                  onSignOut={signOutPostgresSession}
                />
              )}
            >
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





