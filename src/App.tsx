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
  bootstrapPostgres,
  clearPostgresRememberedAccounts,
  clearPostgresUserProjectState,
  getPostgresAuthStatus,
  getPostgresInstallationSettings,
  logoutPostgresAppUser,
  getPostgresStatus,
  getPostgresUserPreferences,
  type PostgresAuthStatus,
  type PostgresInstallationSettings,
  type PostgresStatus,
  type PostgresUserPreferences,
} from "./lib/postgres";
import { initTheme, setRuntimeThemePreferences } from "./theme";
import {
  AppErrorBoundaryWithI18n,
  PostgresProjectEmbeddingBuildBanner,
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
  installationSettings: PostgresInstallationSettings,
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

function applyPostgresRuntimeThemePreferences(preferences: PostgresUserPreferences): void {
  setRuntimeThemePreferences({
    theme: preferences.theme,
    density: preferences.density,
    fontSize: preferences.fontSize,
    themeState: preferences.themeState,
  });
  initTheme();
}

const PostgresProjectsViewLazy = lazy(
  () => import("./views/Postgres_Projects_View").then((m) => ({ default: m.PostgresProjectsView })),
);
const PostgresAdminHandoffViewLazy = lazy(
  () => import("./views/Postgres_Auth_Flow_Views").then((m) => ({ default: m.PostgresAdminHandoffView })),
);
const PostgresLaunchViewLazy = lazy(
  () => import("./views/Postgres_Auth_Flow_Views").then((m) => ({ default: m.PostgresLaunchView })),
);
const PostgresAuthViewLazy = lazy(
  () => import("./views/Postgres_Auth_Flow_Views").then((m) => ({ default: m.PostgresAuthView })),
);
const PostgresProjectHomeViewLazy = lazy(
  () => import("./views/Postgres_Project_Home_View").then((m) => ({ default: m.PostgresProjectHomeView })),
);

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

function AuthGate() {
  const [postgresStatus, setPostgresStatus] = useState<PostgresStatus | null>(null);
  const [postgresStatusLoaded, setPostgresStatusLoaded] = useState(false);
  const [postgresAuthStatus, setPostgresAuthStatus] = useState<PostgresAuthStatus | null>(null);
  const [postgresAuthLoaded, setPostgresAuthLoaded] = useState(false);
  const [postgresInstallationSettings, setPostgresInstallationSettings] = useState<PostgresInstallationSettings | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPostgresRuntimePreferences() {
      if (!postgresAuthStatus?.currentSession) return;
      try {
        const preferences = await getPostgresUserPreferences();
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

    async function loadPostgresState() {
      try {
        const nextStatus = await getPostgresStatus();
        if (cancelled) return;

        setPostgresStatus(nextStatus);
        const nextInstallationSettings = nextStatus.bootstrapApplied
          ? await getPostgresInstallationSettings()
          : null;
        if (!cancelled) {
          setPostgresInstallationSettings(nextInstallationSettings);
          if (nextInstallationSettings) {
            syncLegacyAppSettingsFromPostgresInstallationSettings(nextInstallationSettings);
          }
        }
        if (nextStatus.bootstrapApplied && nextStatus.adminHandoffCompleted) {
          const nextAuthStatus = await getPostgresAuthStatus();
          if (!cancelled) {
            setPostgresAuthStatus(nextAuthStatus);
          }
        } else if (!cancelled) {
          setPostgresAuthStatus(null);
        }
      } catch (error) {
        console.warn("Failed to load PostgreSQL status:", describeUnknownError(error));
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

    void loadPostgresState();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshPostgresStatus() {
    setPostgresStatusLoaded(false);
    setPostgresAuthLoaded(false);
    try {
      const nextStatus = await getPostgresStatus();
      setPostgresStatus(nextStatus);
      const nextInstallationSettings = nextStatus.bootstrapApplied
        ? await getPostgresInstallationSettings()
        : null;
      setPostgresInstallationSettings(nextInstallationSettings);
      if (nextInstallationSettings) {
        syncLegacyAppSettingsFromPostgresInstallationSettings(nextInstallationSettings);
      }
      if (nextStatus.bootstrapApplied && nextStatus.adminHandoffCompleted) {
        const nextAuthStatus = await getPostgresAuthStatus();
        setPostgresAuthStatus(nextAuthStatus);
      } else {
        setPostgresAuthStatus(null);
      }
    } catch (error) {
      console.warn("Failed to refresh PostgreSQL status:", describeUnknownError(error));
    } finally {
      setPostgresStatusLoaded(true);
      setPostgresAuthLoaded(true);
    }
  }

  async function handleBootstrapPostgres(superuserPassword: string) {
    await bootstrapPostgres(superuserPassword);
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
          <p className="auth-starting">
            {postgresAuthReady
              ? "Checking PostgreSQL sign-in status..."
              : "Checking local PostgreSQL status..."}
          </p>
        </div>
      </div>
    );
  }

  const signOutPostgresSession = async () => {
    const nextAuthStatus = await logoutPostgresAppUser();
    if (postgresInstallationSettings?.privacyForgetLoginIdentitiesOnLogout) {
      await clearPostgresRememberedAccounts();
    }
    if (postgresInstallationSettings?.privacyClearRecentProjectsOnSignOut) {
      await clearPostgresUserProjectState();
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
        <PostgresProjectsViewLazy
          renderProjectHome={(openedProject, helpers) => (
            <Suspense
              fallback={<ViewLoadingFallback />}
            >
              <>
                <PostgresProjectEmbeddingBuildBanner activeProject={openedProject} />
                <PostgresProjectHomeViewLazy
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
              </>
            </Suspense>
          )}
        />
      </Suspense>
    );
  }

  if (postgresAuthReady) {
    return (
      <Suspense fallback={<ViewLoadingFallback />}>
        <PostgresAuthViewLazy
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
      <PostgresLaunchViewLazy
        status={postgresStatus}
        loading={!postgresStatusLoaded}
        onRefresh={() => {
          void refreshPostgresStatus();
        }}
        onBootstrap={handleBootstrapPostgres}
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





