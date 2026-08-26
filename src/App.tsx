import {
  lazy,
  Suspense,
  type FormEvent,
  useEffect,
  useState,
} from "react";
import { LoadingCard } from "./components/LoadingCard";
import { AuthProvider } from "./context/AuthContext";
import { I18nProvider } from "./i18n";
import { readAppSettings, saveAppSettings } from "./lib/appSettings";
import {
  bootstrapPostgres,
  changePostgresAppUserPassword,
  getPostgresDeviceState,
  getPostgresAuthStatus,
  getPostgresInstallationSettings,
  logoutPostgresAppUser,
  getPostgresStatus,
  getPostgresUserPreferences,
  rememberPostgresProjectClosed,
  rememberPostgresProjectOpened,
  savePostgresDeviceState,
  startBundledPostgresRuntime,
  type PostgresAuthSession,
  type PostgresAuthStatus,
  type PostgresInstallationSettings,
  type PostgresProject,
  type PostgresStatus,
  type PostgresUserPreferences,
} from "./lib/postgres";
import { initTheme, setRuntimeThemePreferences } from "./theme";
import {
  AppErrorBoundaryWithI18n,
  compareSemver,
  fetchLatestRelease,
  type ReleaseCheckResult,
  PostgresDocumentProcessingBanner,
  PostgresEmbeddingModelDownloadBanner,
  PostgresProjectEmbeddingBuildBanner,
  PostgresProjectSnapshotWarningBanner,
  UpdateAvailableBanner,
} from "./views/App_Shell_Helpers";
import packageJson from "../package.json";
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
      autoNameFromFile: true,
      trimImportedText: installationSettings.documentImportTrimImportedText,
      warnBeforeEmptyImport: true,
    },
    privacy: {
      ...current.privacy,
      maskFilePaths: false,
      clearRecentProjectsOnSignOut: false,
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

function useDisableNativeContextMenu(): void {
  useEffect(() => {
    function handleContextMenu(event: MouseEvent) {
      event.preventDefault();
    }

    window.addEventListener("contextmenu", handleContextMenu);
    return () => {
      window.removeEventListener("contextmenu", handleContextMenu);
    };
  }, []);
}

function PasswordVisibilityIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="password-visibility-icon">
      <path
        d="M2 12s3.5-6 10-6s10 6 10 6s-3.5 6-10 6s-10-6-10-6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function PostgresForcePasswordChangeView({
  session,
  currentPassword,
  onPasswordChanged,
}: {
  session: PostgresAuthSession;
  currentPassword?: string;
  onPasswordChanged: (status: PostgresAuthStatus) => void;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newPasswordVisible, setNewPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const passwordMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!currentPassword) {
      setError("Sign in again before changing this password.");
      return;
    }
    if (!newPassword || !confirmPassword) {
      setError("Choose a new password.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Choose a password with at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      const nextStatus = await changePostgresAppUserPassword({
        currentPassword,
        newPassword,
      });
      onPasswordChanged(nextStatus);
    } catch (changeError) {
      setError(describeUnknownError(changeError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card" style={{ maxWidth: 720 }}>
        <div className="auth-brand-row">
          <img src="/logo.png" alt="" className="auth-brand-row-logo" />
          <div className="auth-brand">KanQual</div>
        </div>
        <form className="form" onSubmit={handleSubmit}>
          <h2 className="auth-panel-title">Change Password</h2>
          <p className="auth-hint">
            This account was created with a temporary password. Choose a new password before continuing.
          </p>
          <p className="auth-hint">Signed in as {session.user.username}</p>
          <label className="form-label">
            New password
            <div className="password-input-wrap">
              <input
                className="form-input password-input-field"
                type={newPasswordVisible ? "text" : "password"}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoFocus
                autoComplete="new-password"
                disabled={saving}
              />
              <button
                type="button"
                className="password-visibility-btn"
                aria-label={newPasswordVisible ? "Hide password" : "Show password"}
                aria-pressed={newPasswordVisible}
                onClick={() => setNewPasswordVisible((current) => !current)}
                disabled={saving}
              >
                <PasswordVisibilityIcon />
              </button>
            </div>
            <p className="password-requirement-note">Minimum 8 characters.</p>
          </label>
          <label className="form-label">
            Confirm password
            <div className="password-input-wrap">
              <input
                className="form-input password-input-field"
                type={confirmPasswordVisible ? "text" : "password"}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                disabled={saving}
              />
              <button
                type="button"
                className="password-visibility-btn"
                aria-label={confirmPasswordVisible ? "Hide password" : "Show password"}
                aria-pressed={confirmPasswordVisible}
                onClick={() => setConfirmPasswordVisible((current) => !current)}
                disabled={saving}
              >
                <PasswordVisibilityIcon />
              </button>
            </div>
          </label>
          {passwordMismatch ? (
            <p className="settings-warning settings-warning--danger" style={{ margin: 0 }}>
              The password entries do not match.
            </p>
          ) : null}
          {error ? <p className="auth-error">{error}</p> : null}
          <div className="form-actions" style={{ justifyContent: "flex-end" }}>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={saving || !currentPassword || newPassword.length < 8 || !confirmPassword || passwordMismatch}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

async function ensureBundledPostgresRuntimeStarted(): Promise<void> {
  try {
    await startBundledPostgresRuntime();
  } catch (error) {
    console.warn("Could not start bundled PostgreSQL runtime:", describeUnknownError(error));
  }
}

const PostgresProjectsViewLazy = lazy(
  () => import("./views/Postgres_Projects_View").then((m) => ({ default: m.PostgresProjectsView })),
);
const PostgresLaunchViewLazy = lazy(
  () => import("./views/Postgres_Auth_Flow_Views").then((m) => ({ default: m.PostgresLaunchView })),
);
const PostgresAuthViewLazy = lazy(
  () => import("./views/Postgres_Auth_Flow_Views").then((m) => ({ default: m.PostgresAuthView })),
);
const PostgresWorkspaceModeChoiceViewLazy = lazy(
  () => import("./views/Postgres_Auth_Flow_Views").then((m) => ({ default: m.PostgresWorkspaceModeChoiceView })),
);
const PostgresProjectHomeViewLazy = lazy(
  () => import("./views/Postgres_Project_Home_View").then((m) => ({ default: m.PostgresProjectHomeView })),
);
const PostgresAdminSettingsViewLazy = lazy(
  () => import("./views/Postgres_Admin_Settings_View").then((m) => ({ default: m.PostgresAdminSettingsView })),
);

function ViewLoadingFallback() {
  return (
    <div className="view-loading-state">
      <LoadingCard />
    </div>
  );
}

function AuthLoadingFallback() {
  return (
    <div className="auth-screen">
      <LoadingCard />
    </div>
  );
}

function PostgresStartupErrorCard({
  error,
  retrying,
  onRetry,
}: {
  error: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="auth-screen">
      <div className="auth-card auth-card--startup">
        <div className="auth-brand-row">
          <img src="/logo.png" alt="" className="auth-brand-row-logo" />
          <div className="auth-brand">KanQual</div>
        </div>
        <div className="form" style={{ width: "100%" }}>
          <h2 className="auth-panel-title">Could Not Start</h2>
          <p className="auth-error">{error}</p>
          <div className="form-actions" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn btn--primary" onClick={onRetry} disabled={retrying}>
              {retrying ? "Retrying..." : "Retry"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function loadReadyPostgresStatus(): Promise<PostgresStatus> {
  await ensureBundledPostgresRuntimeStarted();
  let latestStatus = await getPostgresStatus();
  if (!latestStatus.bootstrapApplied || !latestStatus.adminHandoffCompleted || latestStatus.serviceReachable) {
    return latestStatus;
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await wait(500);
    latestStatus = await getPostgresStatus();
    if (latestStatus.serviceReachable) return latestStatus;
  }

  throw new Error(
    `PostgreSQL setup is complete, but the local database is not reachable at ${latestStatus.host}:${latestStatus.port}.`,
  );
}

function AuthGate() {
  const [postgresStatus, setPostgresStatus] = useState<PostgresStatus | null>(null);
  const [postgresStatusLoaded, setPostgresStatusLoaded] = useState(false);
  const [postgresAuthStatus, setPostgresAuthStatus] = useState<PostgresAuthStatus | null>(null);
  const [postgresAuthLoaded, setPostgresAuthLoaded] = useState(false);
  const [postgresStartupError, setPostgresStartupError] = useState("");
  const [postgresInstallationSettings, setPostgresInstallationSettings] = useState<PostgresInstallationSettings | null>(null);
  const [pendingFirstRunSession, setPendingFirstRunSession] = useState<PostgresAuthSession | null>(null);
  const [pendingPasswordResetCurrentPassword, setPendingPasswordResetCurrentPassword] = useState("");
  const [workspaceModeSelected, setWorkspaceModeSelected] = useState(false);
  const [adminOpenedProject, setAdminOpenedProject] = useState<PostgresProject | null>(null);
  const [availableUpdate, setAvailableUpdate] = useState<ReleaseCheckResult | null>(null);

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

    async function checkForAvailableUpdate() {
      const session = postgresAuthStatus?.currentSession;
      if (
        !session
        || session.authKind !== "app_user"
        || !postgresInstallationSettings?.updatesAutoCheck
        || !postgresInstallationSettings.updatesBannerEnabled
      ) {
        setAvailableUpdate(null);
        return;
      }

      try {
        const [latestRelease, deviceState] = await Promise.all([
          fetchLatestRelease(),
          getPostgresDeviceState(),
        ]);
        if (cancelled) return;
        if (
          latestRelease
          && compareSemver(latestRelease.latestVersion, packageJson.version) > 0
          && deviceState.dismissedUpdateVersion !== latestRelease.latestVersion
        ) {
          setAvailableUpdate(latestRelease);
        } else {
          setAvailableUpdate(null);
        }
      } catch (error) {
        console.warn("Could not check for KanQual updates:", describeUnknownError(error));
        if (!cancelled) setAvailableUpdate(null);
      }
    }

    void checkForAvailableUpdate();
    return () => {
      cancelled = true;
    };
  }, [
    postgresAuthStatus?.currentSession?.authKind,
    postgresAuthStatus?.currentSession?.user.id,
    postgresInstallationSettings?.updatesAutoCheck,
    postgresInstallationSettings?.updatesBannerEnabled,
  ]);

  function renderUpdateAvailableBanner() {
    if (!availableUpdate) return null;
    return (
      <UpdateAvailableBanner
        version={availableUpdate.latestVersion}
        releaseUrl={availableUpdate.releaseUrl}
        onDismiss={() => {
          const dismissedVersion = availableUpdate.latestVersion;
          setAvailableUpdate(null);
          void savePostgresDeviceState({ dismissedUpdateVersion: dismissedVersion });
        }}
      />
    );
  }

  useEffect(() => {
    let cancelled = false;

    async function loadPostgresState() {
      try {
        setPostgresStartupError("");
        const nextStatus = await loadReadyPostgresStatus();
        if (cancelled) return;

        setPostgresStatus(nextStatus);
        if (nextStatus.bootstrapApplied && nextStatus.adminHandoffCompleted) {
          const nextAuthStatus = await getPostgresAuthStatus();
          if (!cancelled) {
            setPostgresAuthStatus(nextAuthStatus);
            const nextInstallationSettings = nextAuthStatus.currentSession
              ? await getPostgresInstallationSettings()
              : null;
            if (!cancelled) {
              setPostgresInstallationSettings(nextInstallationSettings);
              if (nextInstallationSettings) {
                syncLegacyAppSettingsFromPostgresInstallationSettings(nextInstallationSettings);
              }
            }
          }
        } else if (!cancelled) {
          setPostgresAuthStatus(null);
          setPostgresInstallationSettings(null);
        }
      } catch (error) {
        const message = describeUnknownError(error);
        console.warn("Failed to load PostgreSQL status:", message);
        if (!cancelled) {
          setPostgresStatus(null);
          setPostgresAuthStatus(null);
          setPostgresInstallationSettings(null);
          setPostgresStartupError(message);
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
      setPostgresStartupError("");
      const nextStatus = await loadReadyPostgresStatus();
      setPostgresStatus(nextStatus);
      if (nextStatus.bootstrapApplied && nextStatus.adminHandoffCompleted) {
        const nextAuthStatus = await getPostgresAuthStatus();
        setPostgresAuthStatus(nextAuthStatus);
        const nextInstallationSettings = nextAuthStatus.currentSession
          ? await getPostgresInstallationSettings()
          : null;
        setPostgresInstallationSettings(nextInstallationSettings);
        if (nextInstallationSettings) {
          syncLegacyAppSettingsFromPostgresInstallationSettings(nextInstallationSettings);
        }
      } else {
        setPostgresAuthStatus(null);
        setPostgresInstallationSettings(null);
      }
    } catch (error) {
      const message = describeUnknownError(error);
      console.warn("Failed to refresh PostgreSQL status:", message);
      setPostgresStatus(null);
      setPostgresAuthStatus(null);
      setPostgresInstallationSettings(null);
      setPostgresStartupError(message);
    } finally {
      setPostgresStatusLoaded(true);
      setPostgresAuthLoaded(true);
    }
  }

  async function handleBootstrapPostgres(superuserPassword: string) {
    await bootstrapPostgres(superuserPassword);
    await refreshPostgresStatus();
  }

  async function refreshPostgresInstallationSettings() {
    const nextInstallationSettings = await getPostgresInstallationSettings();
    setPostgresInstallationSettings(nextInstallationSettings);
    syncLegacyAppSettingsFromPostgresInstallationSettings(nextInstallationSettings);
    return nextInstallationSettings;
  }

  const postgresAuthReady = !!(
    postgresStatusLoaded
    && postgresStatus
    && postgresStatus.bootstrapApplied
    && postgresStatus.adminHandoffCompleted
  );

  if (!postgresStatusLoaded || (postgresAuthReady && !postgresAuthLoaded)) {
    return <AuthLoadingFallback />;
  }

  if (postgresStartupError && !postgresStatus) {
    return (
      <PostgresStartupErrorCard
        error={postgresStartupError}
        retrying={!postgresStatusLoaded}
        onRetry={() => {
          void refreshPostgresStatus();
        }}
      />
    );
  }

  const signOutPostgresSession = async () => {
    const nextAuthStatus = await logoutPostgresAppUser();
    setAdminOpenedProject(null);
    setPendingPasswordResetCurrentPassword("");
    setPostgresAuthStatus(nextAuthStatus);
    setWorkspaceModeSelected(false);
  };

  const clearPostgresAuthSession = () => {
    setAdminOpenedProject(null);
    setPendingPasswordResetCurrentPassword("");
    setPostgresAuthStatus((current) => current
      ? {
          ...current,
          currentSession: null,
        }
      : current);
    setWorkspaceModeSelected(false);
  };

  const applyPostgresAppUserSession = (session: PostgresAuthSession, registeredUserCount = 0) => {
    setPendingPasswordResetCurrentPassword("");
    setWorkspaceModeSelected(true);
    void refreshPostgresInstallationSettings().catch((error) => {
      console.warn("Could not refresh PostgreSQL installation settings:", describeUnknownError(error));
    });
    setPostgresAuthStatus((current) => current
      ? {
          ...current,
          currentSession: session,
          requiresAccountSetup: false,
          registeredUserCount: Math.max(current.registeredUserCount, registeredUserCount),
        }
      : {
          bootstrapApplied: true,
          adminHandoffCompleted: true,
          ready: true,
          registeredUserCount,
          localAdminName: "",
          requiresAccountSetup: false,
          currentSession: session,
        });
  };

  if (pendingFirstRunSession) {
    return (
      <Suspense fallback={<AuthLoadingFallback />}>
        <PostgresWorkspaceModeChoiceViewLazy
          onUseLocal={() => {
            const session = pendingFirstRunSession;
            setPendingFirstRunSession(null);
            setWorkspaceModeSelected(true);
            applyPostgresAppUserSession(session, 1);
          }}
        />
      </Suspense>
    );
  }

  if (
    postgresAuthReady
    && postgresAuthStatus?.requiresAccountSetup
    && postgresAuthStatus.currentSession?.authKind === "postgres_admin"
  ) {
    return (
      <Suspense fallback={<AuthLoadingFallback />}>
        <PostgresAuthViewLazy
          authStatus={postgresAuthStatus}
          onRefresh={refreshPostgresStatus}
          onFirstAccountCreated={async (session) => {
            setPendingFirstRunSession(session);
          }}
          onAuthenticated={async (session) => {
            if (session.authKind === "postgres_admin") {
              setPendingPasswordResetCurrentPassword("");
              await refreshPostgresStatus();
              return;
            }
            setPendingPasswordResetCurrentPassword("");
            await refreshPostgresInstallationSettings();
            setWorkspaceModeSelected(true);
            setPostgresAuthStatus((current) => current
              ? {
                  ...current,
                  currentSession: session,
                  requiresAccountSetup: false,
                  registeredUserCount: Math.max(current.registeredUserCount, 1),
                }
              : {
                  bootstrapApplied: true,
                  adminHandoffCompleted: true,
                  ready: true,
                  registeredUserCount: 1,
                  localAdminName: "",
                  requiresAccountSetup: false,
                  currentSession: session,
                });
          }}
        />
      </Suspense>
    );
  }

  if (
    postgresAuthReady
    && postgresAuthStatus?.currentSession?.authKind === "postgres_admin"
  ) {
    if (adminOpenedProject) {
      return (
        <Suspense fallback={<ViewLoadingFallback />}>
          <PostgresEmbeddingModelDownloadBanner />
          <PostgresProjectEmbeddingBuildBanner activeProject={adminOpenedProject} />
          <PostgresDocumentProcessingBanner />
          <PostgresProjectSnapshotWarningBanner activeProject={adminOpenedProject} />
          <PostgresProjectHomeViewLazy
            project={adminOpenedProject}
            authSession={postgresAuthStatus.currentSession}
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
                    localAdminName: "",
                    requiresAccountSetup: false,
                    currentSession: session,
                  });
            }}
            onAuthSessionInvalidated={clearPostgresAuthSession}
            installationSettings={postgresInstallationSettings}
            onBack={() => {
              const projectToClose = adminOpenedProject;
              if (projectToClose) {
                void rememberPostgresProjectClosed(projectToClose.id).catch((error) => {
                  console.warn("Could not persist PostgreSQL project close log:", describeUnknownError(error));
                });
              }
              setAdminOpenedProject(null);
            }}
            onProjectUpdated={(project) => setAdminOpenedProject(project)}
            onProjectDeleted={(projectId) => {
              if (adminOpenedProject.id === projectId) {
                setAdminOpenedProject(null);
              }
            }}
            onProjectOpened={async (project) => {
              if (adminOpenedProject && adminOpenedProject.id !== project.id) {
                await rememberPostgresProjectClosed(adminOpenedProject.id).catch((error) => {
                  console.warn("Could not persist PostgreSQL project close log:", describeUnknownError(error));
                });
              }
              await rememberPostgresProjectOpened({
                id: project.id,
                name: project.name,
                description: project.description,
                openedAt: new Date().toISOString(),
              });
              setAdminOpenedProject(project);
            }}
            onSignOut={async () => {
              const projectToClose = adminOpenedProject;
              if (projectToClose) {
                await rememberPostgresProjectClosed(projectToClose.id).catch((error) => {
                  console.warn("Could not persist PostgreSQL project close log:", describeUnknownError(error));
                });
              }
              await signOutPostgresSession();
            }}
          />
        </Suspense>
      );
    }

    return (
      <Suspense fallback={<AuthLoadingFallback />}>
        <PostgresEmbeddingModelDownloadBanner />
        <PostgresAdminSettingsViewLazy
          authSession={postgresAuthStatus.currentSession}
          onOpenProject={async (project) => {
            await rememberPostgresProjectOpened({
              id: project.id,
              name: project.name,
              description: project.description,
              openedAt: new Date().toISOString(),
            });
            const nextInstallationSettings = await getPostgresInstallationSettings();
            setPostgresInstallationSettings(nextInstallationSettings);
            syncLegacyAppSettingsFromPostgresInstallationSettings(nextInstallationSettings);
            setAdminOpenedProject(project);
          }}
          onSignOut={signOutPostgresSession}
        />
      </Suspense>
    );
  }

  if (
    postgresAuthReady
    && postgresAuthStatus?.currentSession?.authKind === "app_user"
    && postgresAuthStatus.currentSession.user.mustChangePassword
  ) {
    return (
      <PostgresForcePasswordChangeView
        session={postgresAuthStatus.currentSession}
        currentPassword={pendingPasswordResetCurrentPassword}
        onPasswordChanged={(nextStatus) => {
          setPendingPasswordResetCurrentPassword("");
          setPostgresAuthStatus(nextStatus);
          setWorkspaceModeSelected(false);
        }}
      />
    );
  }

  if (postgresAuthReady && postgresAuthStatus?.currentSession) {
    return (
      <Suspense fallback={<ViewLoadingFallback />}>
        {renderUpdateAvailableBanner()}
        <PostgresProjectsViewLazy
          onSignOut={signOutPostgresSession}
          renderProjectHome={(openedProject, helpers) => (
            <Suspense
              fallback={<ViewLoadingFallback />}
            >
              <>
                <PostgresEmbeddingModelDownloadBanner />
                <PostgresProjectEmbeddingBuildBanner activeProject={openedProject} />
                <PostgresDocumentProcessingBanner />
                <PostgresProjectSnapshotWarningBanner activeProject={openedProject} />
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
                          localAdminName: "",
                          requiresAccountSetup: false,
                          currentSession: session,
                        });
                  }}
                  onAuthSessionInvalidated={clearPostgresAuthSession}
                  installationSettings={postgresInstallationSettings}
                  onBack={helpers.onBack}
                  onProjectUpdated={helpers.onProjectUpdated}
                  onProjectDeleted={helpers.onProjectDeleted}
                  onProjectOpened={helpers.onProjectOpened}
                  onSignOut={async () => {
                    await rememberPostgresProjectClosed(openedProject.id).catch((error) => {
                      console.warn("Could not persist PostgreSQL project close log:", describeUnknownError(error));
                    });
                    await signOutPostgresSession();
                  }}
                />
              </>
            </Suspense>
          )}
        />
      </Suspense>
    );
  }

  if (postgresAuthReady && !workspaceModeSelected) {
    return (
      <Suspense fallback={<AuthLoadingFallback />}>
        <PostgresWorkspaceModeChoiceViewLazy
          onUseLocal={() => setWorkspaceModeSelected(true)}
        />
      </Suspense>
    );
  }

  if (postgresAuthReady) {
    return (
      <Suspense fallback={<AuthLoadingFallback />}>
        <PostgresAuthViewLazy
          authStatus={postgresAuthStatus}
          onRefresh={refreshPostgresStatus}
          onAuthenticated={async (session, currentPassword) => {
            if (session.authKind === "postgres_admin") {
              setPendingPasswordResetCurrentPassword("");
              await refreshPostgresStatus();
              return;
            }
            setPendingPasswordResetCurrentPassword(session.user.mustChangePassword ? currentPassword ?? "" : "");
            await refreshPostgresInstallationSettings();
            setWorkspaceModeSelected(true);
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
                  localAdminName: "",
                  requiresAccountSetup: false,
                  currentSession: session,
                });
          }}
        />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<AuthLoadingFallback />}>
      <PostgresLaunchViewLazy
        status={postgresStatus}
        loading={!postgresStatusLoaded}
        onBootstrap={handleBootstrapPostgres}
        onRestored={async () => {
          await refreshPostgresStatus();
          setWorkspaceModeSelected(false);
          setPendingFirstRunSession(null);
          setPendingPasswordResetCurrentPassword("");
        }}
        onFirstAccountCreated={async (session) => {
          await refreshPostgresStatus();
          setPendingFirstRunSession(session);
        }}
        onAuthenticated={async (session) => {
          setPendingPasswordResetCurrentPassword("");
          await refreshPostgresStatus();
          await refreshPostgresInstallationSettings();
          setWorkspaceModeSelected(true);
          setPostgresAuthStatus((current) => current
            ? {
                ...current,
                currentSession: session,
                requiresAccountSetup: false,
                registeredUserCount: Math.max(current.registeredUserCount, 1),
              }
            : {
                bootstrapApplied: true,
                adminHandoffCompleted: true,
                ready: true,
                registeredUserCount: 1,
                localAdminName: "",
                requiresAccountSetup: false,
                currentSession: session,
              });
        }}
        onOpenPostgresProjects={() => {
          void refreshPostgresStatus();
        }}
      />
    </Suspense>
  );
}

export default function App() {
  useDisableNativeContextMenu();

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





