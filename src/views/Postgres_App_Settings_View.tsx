import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ThemeManagerModal } from "../components/ThemeManagerModal";
import { SettingsModal } from "../components/SettingsModal";
import { LOCALE_LABELS, SUPPORTED_LOCALES } from "../i18n";
import { useI18n } from "../i18n/provider";
import { getAppRuntimeInfo, type AppRuntimeInfo } from "../lib/dataRoot";
import { buildPermissionMatrixRows } from "../lib/permissionMatrix";
import {
  getPostgresAuthStatus,
  getPostgresInstallationSettings,
  getPostgresStatus,
  getPostgresUserPreferences,
  savePostgresInstallationSettings,
  savePostgresUserPreferences,
  type PostgresAuthSession,
  type PostgresAuthStatus,
  type PostgresInstallationSettings,
  type PostgresProject,
  type PostgresStatus,
  type PostgresUserPreferences,
} from "../lib/postgres";
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
import { PostgresProjectSettingsView } from "./Postgres_Project_Settings_View";
import { PostgresUserSettingsView } from "./Postgres_User_Settings_View";
import thirdPartyNoticesRaw from "../../THIRD_PARTY_NOTICES.md?raw";

export type PostgresAppSettingsViewProps = {
  authSession: PostgresAuthSession;
  project?: PostgresProject;
  canManageProject?: boolean;
  memberCount?: number;
  ownerCount?: number;
  objectCount?: number;
  relationshipCount?: number;
  onProjectUpdated?: (project: PostgresProject) => void;
  onProjectDeleted?: (projectId: string) => void;
  onProjectOpened?: (project: PostgresProject) => void | Promise<void>;
  onAuthSessionUpdated?: (session: PostgresAuthSession) => void;
  onAuthSessionInvalidated?: () => void;
};

type AppSettingsModalId =
  | "appearance"
  | "language"
  | "import"
  | "privacy"
  | "storage"
  | "diagnostics"
  | "permissions";

type LicenseRow = {
  name: string;
  version: string;
  license: string;
};

function parseMarkdownLicenseTable(markdown: string, heading: string): LicenseRow[] {
  const sectionPattern = new RegExp(`## ${heading}\\r?\\n([\\s\\S]*?)(\\r?\\n## |$)`);
  const sectionMatch = markdown.match(sectionPattern);
  if (!sectionMatch) return [];

  const lines = sectionMatch[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const tableLines = lines.filter((line) => line.startsWith("|"));
  if (tableLines.length < 3) return [];

  return tableLines.slice(2).map((line) => {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim().replace(/^`|`$/g, ""));
    return {
      name: cells[0] ?? "",
      version: cells[1] ?? "",
      license: cells[2] ?? "",
    };
  });
}

const aboutJavascriptLicenses = parseMarkdownLicenseTable(
  thirdPartyNoticesRaw,
  "Resolved JavaScript / TypeScript Dependency Inventory",
);

const aboutRustLicenses = parseMarkdownLicenseTable(
  thirdPartyNoticesRaw,
  "Resolved Rust Crate Inventory",
);

const RELEASE_DATE = "June 12, 2026";

function SettingsModalSection({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className="app-settings-modal-section">
      <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
        <h3>{title}</h3>
      </div>
      {children ? <div className="app-settings-modal-section-body">{children}</div> : null}
    </section>
  );
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

function applyPostgresRuntimeThemePreferences(preferences: PostgresUserPreferences): void {
  setRuntimeThemePreferences({
    theme: preferences.theme,
    density: preferences.density,
    fontSize: preferences.fontSize,
    themeState: preferences.themeState,
  });
  initTheme();
}

function formatPostgresDateTime(iso: string): string {
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

export function PostgresAppSettingsView({
  authSession,
  project,
  canManageProject = false,
  memberCount = 0,
  ownerCount = 0,
  objectCount = 0,
  relationshipCount = 0,
  onProjectUpdated,
  onProjectDeleted,
  onProjectOpened,
  onAuthSessionUpdated,
  onAuthSessionInvalidated,
}: PostgresAppSettingsViewProps) {
  const { locale, setLocale, t } = useI18n();
  const [activeModal, setActiveModal] = useState<AppSettingsModalId | null>(null);
  const [showThemeManager, setShowThemeManager] = useState(false);
  const [installationSettings, setInstallationSettings] = useState<PostgresInstallationSettings | null>(null);
  const [status, setStatus] = useState<PostgresStatus | null>(null);
  const [authStatus, setAuthStatus] = useState<PostgresAuthStatus | null>(null);
  const [appInfo, setAppInfo] = useState<AppRuntimeInfo | null>(null);
  const [aboutCardExpanded, setAboutCardExpanded] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [theme, setTheme] = useState<Theme>("light");
  const [density, setDensity] = useState<Density>("comfortable");
  const [fontSize, setFontSize] = useState<FontSize>("normal");
  const [recentProjectLimit, setRecentProjectLimit] = useState(10);
  const permissionMatrixRows = useMemo(() => buildPermissionMatrixRows(t), [t]);

  const refreshDetails = useCallback(async () => {
    setError("");
    try {
      const [nextInstallationSettings, nextUserPreferences, nextStatus, nextAuthStatus, nextAppInfo] = await Promise.all([
        getPostgresInstallationSettings(),
        getPostgresUserPreferences(),
        getPostgresStatus(),
        getPostgresAuthStatus(),
        getAppRuntimeInfo(),
      ]);
      setInstallationSettings(nextInstallationSettings);
      setStatus(nextStatus);
      setAuthStatus(nextAuthStatus);
      setAppInfo(nextAppInfo);
      setTheme(nextUserPreferences.theme);
      setDensity(nextUserPreferences.density);
      setFontSize(nextUserPreferences.fontSize);
      setRecentProjectLimit(nextUserPreferences.recentProjectLimit);
      if (nextUserPreferences.locale !== locale) setLocale(nextUserPreferences.locale);
      applyPostgresRuntimeThemePreferences(nextUserPreferences);
      setActivePresetId(null);
    } catch (loadError) {
      setError(describeUnknownError(loadError));
    }
  }, [locale, setLocale]);

  useEffect(() => {
    void refreshDetails();
  }, [refreshDetails]);

  const persistInstallationSettings = useCallback(async (next: PostgresInstallationSettings, successMessage: string) => {
    try {
      const saved = await savePostgresInstallationSettings(next);
      setInstallationSettings(saved);
      setNotice(successMessage);
      setError("");
    } catch (saveError) {
      setError(describeUnknownError(saveError));
    }
  }, []);

  const persistUserPreferences = useCallback(async (next: PostgresUserPreferences, successMessage?: string) => {
    try {
      const saved = await savePostgresUserPreferences(next);
      setTheme(saved.theme);
      setDensity(saved.density);
      setFontSize(saved.fontSize);
      setRecentProjectLimit(saved.recentProjectLimit);
      applyPostgresRuntimeThemePreferences(saved);
      if (successMessage) setNotice(successMessage);
      setError("");
    } catch (saveError) {
      setError(describeUnknownError(saveError));
    }
  }, []);

  function persistThemePatch(next: Partial<Pick<PostgresUserPreferences, "theme" | "density" | "fontSize" | "locale">>) {
    void persistUserPreferences({
      theme,
      density,
      fontSize,
      locale,
      recentProjectLimit,
      themeState: getStoredThemeState(),
      ...next,
    });
  }

  async function handleLocaleChange(nextLocale: (typeof SUPPORTED_LOCALES)[number]) {
    setLocale(nextLocale);
    await persistUserPreferences({
      theme,
      density,
      fontSize,
      locale: nextLocale,
      recentProjectLimit,
      themeState: getStoredThemeState(),
    }, "Language updated.");
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

  const groupedCards = [
    {
      id: "preferences",
      title: "Preferences",
      cards: [
        { id: "appearance", title: "Appearance", description: "Adjust the interface theme, density, and text size." },
        { id: "language", title: t("appSettings.sectionTitles.language"), description: t("appSettings.overview.language") },
        { id: "import", title: t("appSettings.sectionTitles.documentImport"), description: t("appSettings.overview.documentImport") },
        { id: "privacy", title: t("appSettings.sectionTitles.privacy"), description: t("appSettings.overview.privacy") },
      ] as Array<{ id: AppSettingsModalId; title: string; description: string }>,
    },
    {
      id: "system",
      title: "System",
      cards: [
        { id: "diagnostics", title: t("appSettings.sectionTitles.diagnostics"), description: t("appSettings.overview.diagnostics") },
        { id: "permissions", title: t("appSettings.permissions.title"), description: t("appSettings.permissions.description") },
        { id: "storage", title: t("appSettings.storage.localStorageTitle"), description: t("appSettings.overview.storage") },
      ] as Array<{ id: AppSettingsModalId; title: string; description: string }>,
    },
  ];

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
          <section className="app-settings-about-card">
            <div className="app-settings-about-header">
              <div className="app-settings-about-copy">
                <h2>{t("appSettings.about.title")}</h2>
                <p>{t("appSettings.about.description")}</p>
              </div>
              <button
                type="button"
                className="btn btn--sm app-settings-about-toggle"
                onClick={() => setAboutCardExpanded((expanded) => !expanded)}
                aria-expanded={aboutCardExpanded}
              >
                {aboutCardExpanded ? t("appSettings.about.collapse") : t("appSettings.about.expand")}
              </button>
            </div>
            {aboutCardExpanded ? (
              <div className="app-settings-about-body">
                <section className="about-kanqual-section">
                  <h4>{t("appSettings.about.release")}</h4>
                  <div className="about-kanqual-meta-grid">
                    <div className="about-kanqual-meta-card">
                      <span className="about-kanqual-meta-label">{t("appSettings.about.version")}</span>
                      <strong>{appInfo?.appVersion ?? "0.9.1"}</strong>
                    </div>
                    <div className="about-kanqual-meta-card">
                      <span className="about-kanqual-meta-label">{t("appSettings.about.releaseDate")}</span>
                      <strong>{RELEASE_DATE}</strong>
                    </div>
                  </div>
                </section>

                <hr className="about-kanqual-separator" />

                <section className="about-kanqual-section">
                  <h4>{t("appSettings.about.createdBy")}</h4>
                  <p>{t("appSettings.about.createdByBody")}</p>
                </section>

                <hr className="about-kanqual-separator" />

                <section className="about-kanqual-section">
                  <h4>{t("appSettings.about.citation")}</h4>
                  <p>{t("appSettings.about.citationNote")}</p>
                  <div className="about-kanqual-citation">
                    {t("appSettings.about.citationExample", {
                      version: appInfo?.appVersion ?? "0.9.1",
                    })}
                  </div>
                </section>

                <hr className="about-kanqual-separator" />

                <section className="about-kanqual-section">
                  <h4>{t("appSettings.about.license")}</h4>
                  <p>{t("appSettings.about.licenseBody")} {t("appSettings.about.licenseNote")}</p>
                </section>

                <hr className="about-kanqual-separator" />

                <section className="about-kanqual-section">
                  <h4>{t("appSettings.about.dependencyLicenses")}</h4>
                  <p className="about-kanqual-license-note">{t("appSettings.about.dependencyLicensesNote")}</p>

                  <div className="about-kanqual-license-block">
                    <h5>{t("appSettings.about.javascriptTypescript")}</h5>
                    <div className="about-kanqual-license-table-wrap">
                      <table className="about-kanqual-license-table">
                        <thead>
                          <tr>
                            <th>{t("appSettings.about.package")}</th>
                            <th>{t("appSettings.about.version")}</th>
                            <th>{t("appSettings.about.license")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {aboutJavascriptLicenses.map((row) => (
                            <tr key={`js-${row.name}-${row.version}`}>
                              <td>{row.name}</td>
                              <td>{row.version}</td>
                              <td>{row.license}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="about-kanqual-license-block">
                    <h5>{t("appSettings.about.rust")}</h5>
                    <div className="about-kanqual-license-table-wrap">
                      <table className="about-kanqual-license-table">
                        <thead>
                          <tr>
                            <th>{t("appSettings.about.crate")}</th>
                            <th>{t("appSettings.about.version")}</th>
                            <th>{t("appSettings.about.license")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {aboutRustLicenses.map((row) => (
                            <tr key={`rust-${row.name}-${row.version}`}>
                              <td>{row.name}</td>
                              <td>{row.version}</td>
                              <td>{row.license}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              </div>
            ) : null}
          </section>

          {onAuthSessionUpdated && onAuthSessionInvalidated ? (
            <section className="app-settings-overview-section">
              <div className="app-settings-overview-section-header">
                <p className="app-settings-overview-section-heading">Account</p>
              </div>
              <PostgresUserSettingsView
                authSession={authSession}
                onAuthSessionUpdated={onAuthSessionUpdated}
                onAuthSessionInvalidated={onAuthSessionInvalidated}
                embedded
                includeAppearance={false}
              />
            </section>
          ) : null}

          {project && onProjectUpdated && onProjectDeleted ? (
            <section className="app-settings-overview-section">
              <div className="app-settings-overview-section-header">
                <p className="app-settings-overview-section-heading">Project</p>
              </div>
              <PostgresProjectSettingsView
                project={project}
                canManageProject={canManageProject}
                memberCount={memberCount}
                ownerCount={ownerCount}
                objectCount={objectCount}
                relationshipCount={relationshipCount}
                onProjectUpdated={onProjectUpdated}
                onProjectDeleted={onProjectDeleted}
                onProjectOpened={onProjectOpened}
                embedded
              />
            </section>
          ) : null}

          <div className="app-settings-overview-sections">
            {groupedCards.map((section) => (
              <section key={section.id} className="app-settings-overview-section">
                <div className="app-settings-overview-section-header">
                  <p className="app-settings-overview-section-heading">{section.title}</p>
                </div>
                <div className="app-settings-overview-grid">
                  {section.cards.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      className="app-settings-overview-card app-settings-overview-card--default"
                      onClick={() => setActiveModal(card.id)}
                    >
                      <h3>{card.title}</h3>
                      <p>{card.description}</p>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>

      {activeModal === "appearance" ? (
        <SettingsModal title="Appearance" onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <SettingsModalSection title="Interface">
                  <div className="settings-row">
                    <div className="settings-row-info"><div className="settings-row-label">Theme</div></div>
                    <div className="theme-options">
                      {(["light", "dark"] as Theme[]).map((option) => (
                        <button
                          key={option}
                          type="button"
                          className={`theme-option${theme === option ? " theme-option--active" : ""}`}
                          onClick={() => {
                            setTheme(option);
                            setActivePresetId(null);
                            applyTheme(option);
                            persistThemePatch({ theme: option });
                          }}
                        >
                          {option === "light" ? "Light" : "Dark"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-info"><div className="settings-row-label">Interface density</div></div>
                    <div className="segmented-control">
                      {(["comfortable", "compact"] as Density[]).map((option) => (
                        <button
                          key={option}
                          type="button"
                          className={density === option ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                          onClick={() => {
                            setDensity(option);
                            applyDensity(option);
                            persistThemePatch({ density: option });
                          }}
                        >
                          {option === "comfortable" ? "Comfortable" : "Compact"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-info"><div className="settings-row-label">Text size</div></div>
                    <div className="segmented-control">
                      {(["small", "normal", "large"] as FontSize[]).map((option) => (
                        <button
                          key={option}
                          type="button"
                          className={fontSize === option ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                          onClick={() => {
                            setFontSize(option);
                            applyFontSize(option);
                            persistThemePatch({ fontSize: option });
                          }}
                        >
                          {option === "small" ? "Small" : option === "normal" ? "Normal" : "Large"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-info"><div className="settings-row-label">Custom theme</div></div>
                    <button type="button" className="btn" onClick={() => setShowThemeManager(true)}>Edit theme</button>
                  </div>
                </SettingsModalSection>
              </div>
            </div>
            <div className="app-settings-modal-footer"><span /><button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button></div>
        </SettingsModal>
      ) : null}

      {activeModal === "language" ? (
        <SettingsModal title={t("appSettings.sectionTitles.language")} onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              <SettingsModalSection title="Language">
                <div className="settings-row settings-row--centered">
                  <div className="settings-row-label">App language</div>
                  <select
                    className="form-input"
                    style={{ width: "max-content", maxWidth: "100%" }}
                    value={locale}
                    onChange={(event) => void handleLocaleChange(event.target.value as (typeof SUPPORTED_LOCALES)[number])}
                  >
                    {SUPPORTED_LOCALES.map((option) => <option key={option} value={option}>{LOCALE_LABELS[option]}</option>)}
                  </select>
                </div>
              </SettingsModalSection>
            </div>
            <div className="app-settings-modal-footer"><span /><button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button></div>
        </SettingsModal>
      ) : null}

      {activeModal === "import" ? (
        <SettingsModal title={t("appSettings.sectionTitles.documentImport")} onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              <SettingsModalSection title="Document Import">
                <label className="settings-row">
                  <span className="settings-row-info"><span className="settings-row-label">Name sources from files</span></span>
                  <input
                    type="checkbox"
                    checked={installationSettings?.documentImportAutoNameFromFile ?? true}
                    onChange={(event) => {
                      if (!installationSettings) return;
                      void persistInstallationSettings({ ...installationSettings, documentImportAutoNameFromFile: event.target.checked }, "Document import settings saved.");
                    }}
                  />
                </label>
                <label className="settings-row">
                  <span className="settings-row-info"><span className="settings-row-label">Warn before empty imports</span></span>
                  <input
                    type="checkbox"
                    checked={installationSettings?.documentImportWarnBeforeEmptyImport ?? true}
                    onChange={(event) => {
                      if (!installationSettings) return;
                      void persistInstallationSettings({ ...installationSettings, documentImportWarnBeforeEmptyImport: event.target.checked }, "Document import settings saved.");
                    }}
                  />
                </label>
              </SettingsModalSection>
            </div>
            <div className="app-settings-modal-footer"><span /><button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button></div>
        </SettingsModal>
      ) : null}

      {activeModal === "privacy" ? (
        <SettingsModal title={t("appSettings.sectionTitles.privacy")} onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              <SettingsModalSection title="Privacy">
                <label className="settings-row">
                  <span className="settings-row-info"><span className="settings-row-label">Mask file paths</span></span>
                  <input
                    type="checkbox"
                    checked={installationSettings?.privacyMaskFilePaths ?? false}
                    onChange={(event) => installationSettings && void persistInstallationSettings({ ...installationSettings, privacyMaskFilePaths: event.target.checked }, "Privacy settings saved.")}
                  />
                </label>
                <label className="settings-row">
                  <span className="settings-row-info"><span className="settings-row-label">Clear recent projects on sign out</span></span>
                  <input
                    type="checkbox"
                    checked={installationSettings?.privacyClearRecentProjectsOnSignOut ?? false}
                    onChange={(event) => installationSettings && void persistInstallationSettings({ ...installationSettings, privacyClearRecentProjectsOnSignOut: event.target.checked }, "Privacy settings saved.")}
                  />
                </label>
                <label className="settings-row">
                  <span className="settings-row-info"><span className="settings-row-label">Forget login identities on logout</span></span>
                  <input
                    type="checkbox"
                    checked={installationSettings?.privacyForgetLoginIdentitiesOnLogout ?? false}
                    onChange={(event) => installationSettings && void persistInstallationSettings({ ...installationSettings, privacyForgetLoginIdentitiesOnLogout: event.target.checked }, "Privacy settings saved.")}
                  />
                </label>
              </SettingsModalSection>
            </div>
            <div className="app-settings-modal-footer"><span /><button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button></div>
        </SettingsModal>
      ) : null}

      {activeModal === "storage" ? (
        <SettingsModal title={t("appSettings.storage.localStorageTitle")} onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              <SettingsModalSection title="Database">
                <div className="home-restricted-list">
                  <div className="home-restricted-item"><span className="home-restricted-label">Host</span><span className="home-restricted-value">{status ? `${status.host}:${status.port}` : "-"}</span></div>
                  <div className="home-restricted-item"><span className="home-restricted-label">Network mode</span><span className="home-restricted-value">{status?.networkMode ?? "-"}</span></div>
                  <div className="home-restricted-item"><span className="home-restricted-label">Control database</span><span className="home-restricted-value">{status?.appDatabase ?? "-"}</span></div>
                </div>
              </SettingsModalSection>
            </div>
            <div className="app-settings-modal-footer"><span /><button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button></div>
        </SettingsModal>
      ) : null}

      {activeModal === "diagnostics" ? (
        <SettingsModal title={t("appSettings.sectionTitles.diagnostics")} onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              <SettingsModalSection title="Database Status">
                <div className="home-restricted-list">
                  <div className="home-restricted-item"><span className="home-restricted-label">Reachable</span><span className="home-restricted-value">{status?.serviceReachable ? "Yes" : "No"}</span></div>
                  <div className="home-restricted-item"><span className="home-restricted-label">Setup complete</span><span className="home-restricted-value">{status?.adminHandoffCompleted ? "Yes" : "No"}</span></div>
                  <div className="home-restricted-item"><span className="home-restricted-label">Registered users</span><span className="home-restricted-value">{authStatus?.registeredUserCount ?? "-"}</span></div>
                  <div className="home-restricted-item"><span className="home-restricted-label">Session started</span><span className="home-restricted-value">{formatPostgresDateTime(new Date(authSession.startedAtMs).toISOString())}</span></div>
                </div>
                <div className="form-actions" style={{ marginTop: 16, justifyContent: "flex-end" }}>
                  <button type="button" className="btn btn--primary" onClick={() => void refreshDetails()}>Re-check</button>
                </div>
              </SettingsModalSection>
            </div>
            <div className="app-settings-modal-footer"><span /><button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button></div>
        </SettingsModal>
      ) : null}

      {activeModal === "permissions" ? (
        <SettingsModal title={t("appSettings.permissions.title")} onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              <SettingsModalSection title="User Roles">
                <div className="users-table-wrap postgres-users-table-wrap" style={{ maxHeight: 420 }}>
                  <table className="users-table">
                    <thead>
                      <tr>
                        <th className="users-th">Area</th>
                        <th className="users-th">Action</th>
                        <th className="users-th">Owner</th>
                        <th className="users-th">Editor</th>
                        <th className="users-th">Viewer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {permissionMatrixRows.map((row) => (
                        <tr className="users-row" key={`${row.category}-${row.permission}`}>
                          <td className="users-td users-td--muted">{row.category}</td>
                          <td className="users-td users-td--name">{row.permission}</td>
                          <td className="users-td">{row.owner ? "Yes" : "No"}</td>
                          <td className="users-td">{row.editor ? "Yes" : "No"}</td>
                          <td className="users-td">{row.viewer ? "Yes" : "No"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SettingsModalSection>
            </div>
            <div className="app-settings-modal-footer"><span /><button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button></div>
        </SettingsModal>
      ) : null}

      {showThemeManager ? (
        <ThemeManagerModal
          onClose={() => setShowThemeManager(false)}
          onApplied={() => void handleThemeManagerApplied()}
          onCanceled={() => setTheme(getStoredTheme())}
        />
      ) : null}
    </div>
  );
}
