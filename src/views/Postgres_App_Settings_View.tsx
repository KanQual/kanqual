import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ActiveThemePreviewRow } from "../components/ActiveThemePreviewRow";
import { LanguageSettingsModal } from "../components/LanguageSettingsModal";
import { ThemeManagerModal } from "../components/ThemeManagerModal";
import { SettingsModal } from "../components/SettingsModal";
import { SUPPORTED_LOCALES } from "../i18n";
import { useI18n } from "../i18n/provider";
import { getAppRuntimeInfo, type AppRuntimeInfo } from "../lib/dataRoot";
import { buildPermissionMatrixRows } from "../lib/permissionMatrix";
import {
  getPostgresUserPreferences,
  savePostgresUserPreferences,
  type PostgresAuthSession,
  type PostgresProject,
  type PostgresUserPreferences,
} from "../lib/postgres";
import {
  applyDensity,
  applyFontSize,
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
  canEditProjectMetadata?: boolean;
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
  | "about"
  | "appearance"
  | "language"
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

export function PostgresAppSettingsView({
  authSession,
  project,
  canManageProject = false,
  canEditProjectMetadata = canManageProject,
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
  const [appInfo, setAppInfo] = useState<AppRuntimeInfo | null>(null);
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
      const [nextUserPreferences, nextAppInfo] = await Promise.all([
        getPostgresUserPreferences(),
        getAppRuntimeInfo(),
      ]);
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
        { id: "appearance", title: "Appearance", icon: "Aa" },
        { id: "language", title: t("appSettings.sectionTitles.language"), icon: "LA" },
      ] as Array<{ id: AppSettingsModalId; title: string; icon: string }>,
    },
    {
      id: "system",
      title: "System",
      cards: [
        { id: "about", title: t("appSettings.about.title"), icon: "KQ" },
        { id: "permissions", title: t("appSettings.permissions.title"), icon: "RO" },
      ] as Array<{ id: AppSettingsModalId; title: string; icon: string }>,
    },
  ];

  return (
    <div className="view app-settings-view app-settings-view--compact">
      <header className="view-header">
        <div className="view-title-with-help">
          <h1>Settings</h1>
        </div>
      </header>

      {notice ? <p className="settings-success">{notice}</p> : null}
      {error ? <p className="auth-error">{error}</p> : null}

      <div className="app-settings-overview-shell">
        <div className="app-settings-overview-stack app-settings-overview-stack--compact">
          {onAuthSessionUpdated && onAuthSessionInvalidated ? (
            <section className="app-settings-overview-section app-settings-overview-section--compact">
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
            <section className="app-settings-overview-section app-settings-overview-section--compact">
              <div className="app-settings-overview-section-header">
                <p className="app-settings-overview-section-heading">Project</p>
              </div>
              <PostgresProjectSettingsView
                project={project}
                canManageProject={canManageProject}
                canEditProjectMetadata={canEditProjectMetadata}
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
              <section key={section.id} className="app-settings-overview-section app-settings-overview-section--compact">
                <div className="app-settings-overview-section-header">
                  <p className="app-settings-overview-section-heading">{section.title}</p>
                </div>
                <div className="app-settings-overview-grid app-settings-overview-grid--compact">
                  {section.cards.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      className="app-settings-overview-card app-settings-overview-card--compact app-settings-overview-card--default"
                      onClick={() => setActiveModal(card.id)}
                    >
                      <span className="app-settings-overview-card-icon" aria-hidden="true">{card.icon}</span>
                      <h3>{card.title}</h3>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>

      {activeModal === "about" ? (
        <SettingsModal title={t("appSettings.about.title")} onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
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
            </div>
            <div className="app-settings-modal-footer"><span /><button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button></div>
        </SettingsModal>
      ) : null}

      {activeModal === "appearance" ? (
        <SettingsModal title="Appearance" onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <SettingsModalSection title="Interface">
                  <ActiveThemePreviewRow theme={theme} onEdit={() => setShowThemeManager(true)} />
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
                </SettingsModalSection>
              </div>
            </div>
            <div className="app-settings-modal-footer"><span /><button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button></div>
        </SettingsModal>
      ) : null}

      {activeModal === "language" ? (
        <LanguageSettingsModal
          title={t("appSettings.sectionTitles.language")}
          label={t("appSettings.language.label")}
          locale={locale}
          onChange={(nextLocale) => void handleLocaleChange(nextLocale)}
          onClose={() => setActiveModal(null)}
        />
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
