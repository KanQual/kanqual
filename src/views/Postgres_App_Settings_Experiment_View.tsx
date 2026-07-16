import { useCallback, useEffect, useState } from "react";
import { ThemeManagerModal } from "../components/ThemeManagerModal";
import { useI18n } from "../i18n/provider";
import { readAppSettings, saveAppSettings } from "../lib/appSettings";
import {
  getPostgresExperimentAuthStatus,
  getPostgresExperimentInstallationSettings,
  getPostgresExperimentStatus,
  getPostgresExperimentUserPreferences,
  listPostgresExperimentProjects,
  savePostgresExperimentInstallationSettings,
  savePostgresExperimentUserPreferences,
  type PostgresExperimentAuthSession,
  type PostgresExperimentAuthStatus,
  type PostgresExperimentInstallationSettings,
  type PostgresExperimentProject,
  type PostgresExperimentStatus,
  type PostgresExperimentUserPreferences,
} from "../lib/postgresExperiment";
import {
  applyDensity,
  applyFontSize,
  applyTheme,
  getStoredTheme,
  getStoredThemeState,
  initTheme,
  setActivePresetId,
  setRuntimeThemePreferences,
  type Density,
  type FontSize,
  type Theme,
} from "../theme";

export type PostgresAppSettingsExperimentViewProps = {
  authSession: PostgresExperimentAuthSession;
};

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function clampIntegerValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
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

function formatPostgresExperimentDateTime(iso: string): string {
  if (!iso) return "-";
  try {
    return new Intl.DateTimeFormat([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "-";
  }
}

export function PostgresAppSettingsExperimentView({
  authSession,
}: PostgresAppSettingsExperimentViewProps) {
  const { locale } = useI18n();
  const [activeModal, setActiveModal] = useState<"startup" | "import" | "privacy" | "updates" | "llm" | "postgres" | null>(null);
  const [showThemeManager, setShowThemeManager] = useState(false);
  const [installationSettings, setInstallationSettings] = useState<PostgresExperimentInstallationSettings | null>(null);
  const [status, setStatus] = useState<PostgresExperimentStatus | null>(null);
  const [authStatus, setAuthStatus] = useState<PostgresExperimentAuthStatus | null>(null);
  const [projects, setProjects] = useState<PostgresExperimentProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [theme, setTheme] = useState<Theme>("light");
  const [density, setDensity] = useState<Density>("comfortable");
  const [fontSize, setFontSize] = useState<FontSize>("normal");
  const [recentProjectLimit, setRecentProjectLimit] = useState(10);

  const persistInstallationSettings = useCallback(async (
    next: PostgresExperimentInstallationSettings,
    successMessage: string,
  ) => {
    const saved = await savePostgresExperimentInstallationSettings(next);
    setInstallationSettings(saved);
    syncLegacyAppSettingsFromPostgresInstallationSettings(saved);
    setNotice(successMessage);
    setError("");
  }, []);

  const persistUserPreferences = useCallback(async (
    next: PostgresExperimentUserPreferences,
    successMessage?: string,
  ) => {
    const saved = await savePostgresExperimentUserPreferences(next);
    setTheme(saved.theme);
    setDensity(saved.density);
    setFontSize(saved.fontSize);
    setRecentProjectLimit(saved.recentProjectLimit);
    applyPostgresRuntimeThemePreferences(saved);
    if (successMessage) setNotice(successMessage);
    setError("");
  }, []);

  const refreshPostgresDetails = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [
        nextStatus,
        nextAuthStatus,
        nextProjects,
        nextInstallationSettings,
        nextUserPreferences,
      ] = await Promise.all([
        getPostgresExperimentStatus(),
        getPostgresExperimentAuthStatus(),
        listPostgresExperimentProjects(),
        getPostgresExperimentInstallationSettings(),
        getPostgresExperimentUserPreferences(),
      ]);
      setStatus(nextStatus);
      setAuthStatus(nextAuthStatus);
      setProjects(nextProjects);
      setInstallationSettings(nextInstallationSettings);
      syncLegacyAppSettingsFromPostgresInstallationSettings(nextInstallationSettings);
      setTheme(nextUserPreferences.theme);
      setDensity(nextUserPreferences.density);
      setFontSize(nextUserPreferences.fontSize);
      setRecentProjectLimit(nextUserPreferences.recentProjectLimit);
      applyPostgresRuntimeThemePreferences(nextUserPreferences);
    } catch (loadError) {
      setError(describeUnknownError(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPostgresDetails();
  }, [refreshPostgresDetails]);

  function handleTheme(nextTheme: Theme) {
    setTheme(nextTheme);
    setActivePresetId(null);
    applyTheme(nextTheme);
    void persistUserPreferences({
      theme: nextTheme,
      density,
      fontSize,
      locale,
      recentProjectLimit,
      themeState: getStoredThemeState(),
    });
  }

  function handleDensity(nextDensity: Density) {
    setDensity(nextDensity);
    applyDensity(nextDensity);
    void persistUserPreferences({
      theme,
      density: nextDensity,
      fontSize,
      locale,
      recentProjectLimit,
      themeState: getStoredThemeState(),
    });
  }

  function handleFontSize(nextFontSize: FontSize) {
    setFontSize(nextFontSize);
    applyFontSize(nextFontSize);
    void persistUserPreferences({
      theme,
      density,
      fontSize: nextFontSize,
      locale,
      recentProjectLimit,
      themeState: getStoredThemeState(),
    });
  }

  async function handleThemeManagerApplied() {
    const nextTheme = getStoredTheme();
    setTheme(nextTheme);
    setActivePresetId(null);
    await persistUserPreferences({
      theme: nextTheme,
      density,
      fontSize,
      locale,
      recentProjectLimit,
      themeState: getStoredThemeState(),
    }, "Theme updated.");
  }

  return (
    <div className="view app-settings-view">
      <header className="view-header">
        <div className="view-title-with-help">
          <h1>App Settings</h1>
        </div>
      </header>

      {notice ? <p className="settings-success">{notice}</p> : null}
      {error ? <p className="auth-error">{error}</p> : null}

      <div className="app-settings-overview-shell">
        <div className="app-settings-overview-stack">
          <div className="app-settings-overview-sections">
            <section className="app-settings-overview-section">
              <div className="app-settings-overview-section-header">
                <p className="app-settings-overview-section-heading">Kanqual</p>
              </div>
              <div className="app-settings-overview-grid">
                <button type="button" className="app-settings-overview-card app-settings-overview-card--default" onClick={() => setActiveModal("startup")}>
                  <h3>Startup</h3>
                  <p>Control launch behavior for this device after you sign in.</p>
                </button>
                <button type="button" className="app-settings-overview-card app-settings-overview-card--default" onClick={() => setActiveModal("import")}>
                  <h3>Document Import</h3>
                  <p>Set shared defaults for uploading, naming, and cleaning imported text.</p>
                </button>
                <button type="button" className="app-settings-overview-card app-settings-overview-card--default" onClick={() => setActiveModal("privacy")}>
                  <h3>Privacy</h3>
                  <p>Choose what Kanqual remembers locally and what it clears on sign-out.</p>
                </button>
                <button type="button" className="app-settings-overview-card app-settings-overview-card--default" onClick={() => setActiveModal("updates")}>
                  <h3>Appearance & Updates</h3>
                  <p>Adjust the interface and background update-check behavior.</p>
                </button>
                <button type="button" className="app-settings-overview-card app-settings-overview-card--default" onClick={() => setActiveModal("llm")}>
                  <h3>AI Assist Runtime</h3>
                  <p>Persist local and cloud LLM defaults for the PostgreSQL experiment in PostgreSQL.</p>
                </button>
                <button type="button" className="app-settings-overview-card app-settings-overview-card--default" onClick={() => setActiveModal("postgres")}>
                  <h3>PostgreSQL Experiment</h3>
                  <p>Review local PostgreSQL status, registered users, and project databases.</p>
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>

      {activeModal === "startup" ? (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal modal--wide app-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-section-header">
              <div><h2 className="settings-section-title">Startup</h2></div>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Launch Behavior</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="settings-warning">
                      Signed-in PostgreSQL sessions end when Kanqual closes. This device can still remember recent accounts and reopen the last project after you sign in again.
                    </div>
                    <label className="settings-toggle-row">
                      <span>
                        <strong>Reopen last project on launch</strong>
                        <small>If the last project still exists, Kanqual will reopen it after sign-in.</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={installationSettings?.startupReopenLastProject ?? false}
                        onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings(
                            { ...installationSettings, startupReopenLastProject: event.target.checked },
                            "Startup behavior saved.",
                          );
                        }}
                      />
                    </label>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <p className="app-settings-modal-footer-note">Changes are saved immediately.</p>
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === "import" ? (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal modal--wide app-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-section-header">
              <div><h2 className="settings-section-title">Document Import</h2></div>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Shared Defaults</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <div className="settings-row-label">Default import mode</div>
                        <div className="settings-row-desc">Choose whether new imports start in upload or paste mode.</div>
                      </div>
                      <div className="theme-options">
                        {(["upload", "paste"] as const).map((option) => (
                          <button
                            key={option}
                            type="button"
                            className={`theme-option ${(installationSettings?.documentImportDefaultMode ?? "upload") === option ? "theme-option--active" : ""}`}
                            onClick={() => {
                              if (!installationSettings) return;
                              void persistInstallationSettings(
                                { ...installationSettings, documentImportDefaultMode: option },
                                "Document import defaults saved.",
                              );
                            }}
                          >
                            {option === "upload" ? "Upload" : "Paste"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label className="settings-toggle-row">
                      <span>
                        <strong>Auto-name from file</strong>
                        <small>Use the source filename as the starting document name when possible.</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={installationSettings?.documentImportAutoNameFromFile ?? true}
                        onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings(
                            { ...installationSettings, documentImportAutoNameFromFile: event.target.checked },
                            "Document import defaults saved.",
                          );
                        }}
                      />
                    </label>
                    <label className="settings-toggle-row">
                      <span>
                        <strong>Trim imported text</strong>
                        <small>Remove leading and trailing whitespace from imported text by default.</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={installationSettings?.documentImportTrimImportedText ?? true}
                        onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings(
                            { ...installationSettings, documentImportTrimImportedText: event.target.checked },
                            "Document import defaults saved.",
                          );
                        }}
                      />
                    </label>
                    <label className="settings-toggle-row">
                      <span>
                        <strong>Warn before empty import</strong>
                        <small>Show a confirmation when an import would create an empty document.</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={installationSettings?.documentImportWarnBeforeEmptyImport ?? true}
                        onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings(
                            { ...installationSettings, documentImportWarnBeforeEmptyImport: event.target.checked },
                            "Document import defaults saved.",
                          );
                        }}
                      />
                    </label>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <p className="app-settings-modal-footer-note">Changes are saved immediately.</p>
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === "privacy" ? (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal modal--wide app-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-section-header">
              <div><h2 className="settings-section-title">Privacy</h2></div>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Local Data</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <label className="settings-toggle-row">
                      <span>
                        <strong>Mask file paths</strong>
                        <small>Hide full local paths in interface text when possible.</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={installationSettings?.privacyMaskFilePaths ?? false}
                        onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings(
                            { ...installationSettings, privacyMaskFilePaths: event.target.checked },
                            "Privacy settings saved.",
                          );
                        }}
                      />
                    </label>
                    <label className="settings-toggle-row">
                      <span>
                        <strong>Clear recent projects on sign-out</strong>
                        <small>Forget the locally stored recent project list when you sign out.</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={installationSettings?.privacyClearRecentProjectsOnSignOut ?? false}
                        onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings(
                            { ...installationSettings, privacyClearRecentProjectsOnSignOut: event.target.checked },
                            "Privacy settings saved.",
                          );
                        }}
                      />
                    </label>
                    <label className="settings-toggle-row">
                      <span>
                        <strong>Forget remembered login identities on sign-out</strong>
                        <small>Remove stored account shortcuts when you sign out of the experiment.</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={installationSettings?.privacyForgetLoginIdentitiesOnLogout ?? false}
                        onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings(
                            { ...installationSettings, privacyForgetLoginIdentitiesOnLogout: event.target.checked },
                            "Privacy settings saved.",
                          );
                        }}
                      />
                    </label>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <p className="app-settings-modal-footer-note">Changes are saved immediately.</p>
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === "updates" ? (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal modal--wide app-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-section-header">
              <div><h2 className="settings-section-title">Appearance & Updates</h2></div>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Appearance</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <div className="settings-row-label">Theme</div>
                        <div className="settings-row-desc">Choose the default theme for this device.</div>
                      </div>
                      <div className="theme-options">
                        {(["light", "dark"] as const).map((option) => (
                          <button key={option} type="button" className={`theme-option ${theme === option ? "theme-option--active" : ""}`} onClick={() => handleTheme(option)}>
                            {option === "light" ? "Light" : "Dark"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <div className="settings-row-label">Density</div>
                        <div className="settings-row-desc">Adjust spacing across the interface.</div>
                      </div>
                      <div className="theme-options">
                        {(["compact", "comfortable"] as const).map((option) => (
                          <button key={option} type="button" className={`theme-option ${density === option ? "theme-option--active" : ""}`} onClick={() => handleDensity(option)}>
                            {option[0].toUpperCase() + option.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <div className="settings-row-label">Font size</div>
                        <div className="settings-row-desc">Control the default reading size.</div>
                      </div>
                      <div className="theme-options">
                        {(["small", "normal", "large"] as const).map((option) => (
                          <button key={option} type="button" className={`theme-option ${fontSize === option ? "theme-option--active" : ""}`} onClick={() => handleFontSize(option)}>
                            {option[0].toUpperCase() + option.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <div className="settings-row-label">Theme Manager</div>
                        <div className="settings-row-desc">Open the theme preset editor.</div>
                      </div>
                      <button type="button" className="btn" onClick={() => setShowThemeManager(true)}>Open Theme Manager</button>
                    </div>
                  </div>
                </section>
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Updates</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <label className="settings-toggle-row">
                      <span>
                        <strong>Automatically check for updates</strong>
                        <small>Look for new Kanqual releases in the background.</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={installationSettings?.updatesAutoCheck ?? true}
                        onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings(
                            { ...installationSettings, updatesAutoCheck: event.target.checked },
                            "Update preferences saved.",
                          );
                        }}
                      />
                    </label>
                    <label className="form-label">
                      Recent projects shown
                      <input
                        className="form-input"
                        type="number"
                        min={1}
                        max={50}
                        value={recentProjectLimit}
                        onChange={(event) => {
                          const nextLimit = clampIntegerValue(Number(event.target.value), 1, 50);
                          setRecentProjectLimit(nextLimit);
                          void persistUserPreferences({
                            theme,
                            density,
                            fontSize,
                            locale,
                            recentProjectLimit: nextLimit,
                            themeState: getStoredThemeState(),
                          }, "Recent-project preference saved.");
                        }}
                      />
                    </label>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <p className="app-settings-modal-footer-note">Changes are saved immediately.</p>
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === "llm" ? (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal modal--wide app-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-section-header">
              <div><h2 className="settings-section-title">AI Assist Runtime</h2></div>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Cloud Runtime Defaults</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <label className="form-label">
                      Provider
                      <input className="form-input" value={installationSettings?.llm.cloudProvider ?? ""} onChange={(event) => {
                        if (!installationSettings) return;
                        const nextProvider = event.target.value as PostgresExperimentInstallationSettings["llm"]["cloudProvider"];
                        void persistInstallationSettings({ ...installationSettings, llm: { ...installationSettings.llm, cloudProvider: nextProvider } }, "LLM settings saved.");
                      }} />
                    </label>
                    <label className="form-label">
                      Model
                      <input className="form-input" value={installationSettings?.llm.cloudSelectedModel ?? ""} onChange={(event) => {
                        if (!installationSettings) return;
                        void persistInstallationSettings({ ...installationSettings, llm: { ...installationSettings.llm, cloudSelectedModel: event.target.value } }, "LLM settings saved.");
                      }} />
                    </label>
                    <label className="form-label">
                      API key / secret
                      <input className="form-input" type="password" value={installationSettings?.llm.cloudApiSecret ?? ""} onChange={(event) => {
                        if (!installationSettings) return;
                        void persistInstallationSettings({ ...installationSettings, llm: { ...installationSettings.llm, cloudApiSecret: event.target.value } }, "LLM settings saved.");
                      }} />
                    </label>
                  </div>
                </section>
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Local Runtime Defaults</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="llm-settings-grid">
                      <label className="form-label">
                        Protocol
                        <select className="form-input" value={installationSettings?.llm.ollamaProtocol ?? "http"} onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings({ ...installationSettings, llm: { ...installationSettings.llm, ollamaProtocol: event.target.value === "https" ? "https" : "http" } }, "LLM settings saved.");
                        }}>
                          <option value="http">http</option>
                          <option value="https">https</option>
                        </select>
                      </label>
                      <label className="form-label">
                        Host
                        <input className="form-input" value={installationSettings?.llm.ollamaHost ?? "127.0.0.1"} onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings({ ...installationSettings, llm: { ...installationSettings.llm, ollamaHost: event.target.value } }, "LLM settings saved.");
                        }} />
                      </label>
                      <label className="form-label">
                        Port
                        <input className="form-input" type="number" min={1} max={65535} value={installationSettings?.llm.ollamaPort ?? 11434} onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings({ ...installationSettings, llm: { ...installationSettings.llm, ollamaPort: clampIntegerValue(Number(event.target.value), 1, 65535) } }, "LLM settings saved.");
                        }} />
                      </label>
                      <label className="form-label">
                        Selected local model
                        <input className="form-input" value={installationSettings?.llm.ollamaSelectedModel ?? ""} onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings({ ...installationSettings, llm: { ...installationSettings.llm, ollamaSelectedModel: event.target.value } }, "LLM settings saved.");
                        }} />
                      </label>
                      <label className="form-label">
                        Request timeout (seconds)
                        <input className="form-input" type="number" min={5} max={600} value={installationSettings?.llm.ollamaRequestTimeoutSeconds ?? 120} onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings({ ...installationSettings, llm: { ...installationSettings.llm, ollamaRequestTimeoutSeconds: clampIntegerValue(Number(event.target.value), 5, 600) } }, "LLM settings saved.");
                        }} />
                      </label>
                      <label className="form-label">
                        Document timeout (seconds)
                        <input className="form-input" type="number" min={30} max={3600} value={installationSettings?.llm.ollamaDocumentProcessingTimeoutSeconds ?? 1800} onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings({ ...installationSettings, llm: { ...installationSettings.llm, ollamaDocumentProcessingTimeoutSeconds: clampIntegerValue(Number(event.target.value), 30, 3600) } }, "LLM settings saved.");
                        }} />
                      </label>
                      <label className="form-label">
                        Temperature
                        <input className="form-input" type="number" min={0} max={2} step={0.1} value={installationSettings?.llm.ollamaTemperature ?? 0.2} onChange={(event) => {
                          if (!installationSettings) return;
                          const temperature = Number(event.target.value);
                          void persistInstallationSettings({ ...installationSettings, llm: { ...installationSettings.llm, ollamaTemperature: Number.isFinite(temperature) ? Math.max(0, Math.min(2, temperature)) : 0 } }, "LLM settings saved.");
                        }} />
                      </label>
                      <label className="form-label">
                        Context window
                        <input className="form-input" type="number" min={256} max={131072} value={installationSettings?.llm.ollamaNumCtx ?? 8192} onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings({ ...installationSettings, llm: { ...installationSettings.llm, ollamaNumCtx: clampIntegerValue(Number(event.target.value), 256, 131072) } }, "LLM settings saved.");
                        }} />
                      </label>
                      <label className="form-label">
                        Keep alive (minutes)
                        <input className="form-input" type="number" min={0} max={1440} value={installationSettings?.llm.ollamaKeepAliveMinutes ?? 10} onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings({ ...installationSettings, llm: { ...installationSettings.llm, ollamaKeepAliveMinutes: clampIntegerValue(Number(event.target.value), 0, 1440) } }, "LLM settings saved.");
                        }} />
                      </label>
                      <label className="form-label">
                        Relevant-segment shortlist
                        <input className="form-input" type="number" min={1} max={50} value={installationSettings?.llm.ollamaRelevantSegmentsCandidateLimit ?? 12} onChange={(event) => {
                          if (!installationSettings) return;
                          const candidateLimit = clampIntegerValue(Number(event.target.value), 1, 50);
                          void persistInstallationSettings({
                            ...installationSettings,
                            llm: {
                              ...installationSettings.llm,
                              ollamaRelevantSegmentsCandidateLimit: candidateLimit,
                              ollamaRelevantSegmentsMaxResults: Math.min(installationSettings.llm.ollamaRelevantSegmentsMaxResults, candidateLimit),
                            },
                          }, "LLM settings saved.");
                        }} />
                      </label>
                      <label className="form-label">
                        Relevant segments returned
                        <input className="form-input" type="number" min={1} max={installationSettings?.llm.ollamaRelevantSegmentsCandidateLimit ?? 12} value={installationSettings?.llm.ollamaRelevantSegmentsMaxResults ?? 6} onChange={(event) => {
                          if (!installationSettings) return;
                          void persistInstallationSettings({
                            ...installationSettings,
                            llm: {
                              ...installationSettings.llm,
                              ollamaRelevantSegmentsMaxResults: clampIntegerValue(Number(event.target.value), 1, installationSettings.llm.ollamaRelevantSegmentsCandidateLimit),
                            },
                          }, "LLM settings saved.");
                        }} />
                      </label>
                    </div>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <p className="app-settings-modal-footer-note">Changes are saved immediately.</p>
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === "postgres" ? (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal modal--wide app-settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-section-header">
              <div><h2 className="settings-section-title">PostgreSQL Experiment</h2></div>
              <button type="button" className="btn" onClick={() => void refreshPostgresDetails()} disabled={loading}>
                {loading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default"><h3>Current Session</h3></div>
                  <div className="app-settings-modal-section-body">
                    <div className="home-restricted-list">
                      <div className="home-restricted-item"><span className="home-restricted-label">Signed in as</span><span className="home-restricted-value">{authSession.user.name}</span></div>
                      <div className="home-restricted-item"><span className="home-restricted-label">Role</span><span className="home-restricted-value">{authSession.authKind === "postgres_admin" ? "Local administrator" : authSession.user.role}</span></div>
                      <div className="home-restricted-item"><span className="home-restricted-label">Session started</span><span className="home-restricted-value">{formatPostgresExperimentDateTime(new Date(authSession.startedAtMs).toISOString())}</span></div>
                    </div>
                  </div>
                </section>
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default"><h3>Local PostgreSQL</h3></div>
                  <div className="app-settings-modal-section-body">
                    <div className="home-restricted-list">
                      <div className="home-restricted-item"><span className="home-restricted-label">Host</span><span className="home-restricted-value">{status ? `${status.host}:${status.port}` : "-"}</span></div>
                      <div className="home-restricted-item"><span className="home-restricted-label">Reachable</span><span className="home-restricted-value">{status?.serviceReachable ? "Yes" : "No"}</span></div>
                      <div className="home-restricted-item"><span className="home-restricted-label">Bootstrap applied</span><span className="home-restricted-value">{status?.bootstrapApplied ? "Yes" : "No"}</span></div>
                      <div className="home-restricted-item"><span className="home-restricted-label">Admin handoff complete</span><span className="home-restricted-value">{status?.adminHandoffCompleted ? "Yes" : "No"}</span></div>
                      <div className="home-restricted-item"><span className="home-restricted-label">App role</span><span className="home-restricted-value">{status ? `${status.appRoleName} -> ${status.appDatabase}` : "-"}</span></div>
                    </div>
                  </div>
                </section>
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default"><h3>Workspace Summary</h3></div>
                  <div className="app-settings-modal-section-body">
                    <div className="home-restricted-list">
                      <div className="home-restricted-item"><span className="home-restricted-label">Registered users</span><span className="home-restricted-value">{authStatus?.registeredUserCount ?? "-"}</span></div>
                      <div className="home-restricted-item"><span className="home-restricted-label">Project databases</span><span className="home-restricted-value">{projects.length}</span></div>
                    </div>
                    {projects.length > 0 ? (
                      <div className="users-table-wrap postgres-users-table-wrap" style={{ marginTop: 16, maxHeight: 280 }}>
                        <table className="users-table">
                          <thead><tr><th className="users-th">Project</th><th className="users-th">Database</th><th className="users-th">Updated</th></tr></thead>
                          <tbody>
                            {projects.map((project) => (
                              <tr key={project.id} className="users-row">
                                <td className="users-td users-td--name">{project.name}</td>
                                <td className="users-td users-td--muted">{project.databaseName}</td>
                                <td className="users-td users-td--muted">{formatPostgresExperimentDateTime(project.updatedAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="auth-hint" style={{ marginTop: 12 }}>No PostgreSQL project databases have been created yet.</p>
                    )}
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button>
            </div>
          </div>
        </div>
      ) : null}

      {showThemeManager ? (
        <ThemeManagerModal
          onClose={() => setShowThemeManager(false)}
          onApplied={() => void handleThemeManagerApplied()}
          onCanceled={() => {
            setTheme(getStoredTheme());
          }}
        />
      ) : null}
    </div>
  );
}
