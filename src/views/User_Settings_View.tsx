import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import { useStore } from "../context/StoreContext";
import { useI18n } from "../i18n/provider";
import { ThemeManagerModal } from "./App_Settings_View";
import { HelpIcon } from "../components/AppIcons";
import { formatCurrentDateTime } from "../i18n/formatters";
import {
  applyDensity,
  applyFontSize,
  applyTheme,
  getStoredDensity,
  getStoredFontSize,
  getStoredTheme,
  setActivePresetId,
  type Density,
  type FontSize,
  type Theme,
} from "../theme";

type UserSettingsModal = "profile" | "password" | "appearance" | "recent" | null;

type RecentProject = {
  id: string;
  name: string;
  description?: string;
  openedAt: string;
};

type SettingsModalSectionProps = {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  tone?: "default" | "warning" | "danger";
};

function SettingsModalSection({
  title,
  children,
  tone = "default",
}: SettingsModalSectionProps) {
  return (
    <section className="app-settings-modal-section">
      <div className={`app-settings-modal-section-header app-settings-modal-section-header--${tone}`}>
        <h3>{title}</h3>
      </div>
      {children ? <div className="app-settings-modal-section-body">{children}</div> : null}
    </section>
  );
}

const RECENT_PROJECTS_KEY = "kq_recent_projects";
const RECENT_LIMIT_KEY = "kq_recent_project_limit";

function readRecentProjects(): RecentProject[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_PROJECTS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function readRecentLimit(): number {
  return Number(localStorage.getItem(RECENT_LIMIT_KEY) ?? "10");
}

function fmtRecentDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return formatCurrentDateTime(date, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function UserSettingsView() {
  const { t } = useI18n();
  const { user, updateProfile, changePassword } = useAuth();
  const { projects, openProject, activeProject } = useStore();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [theme, setTheme] = useState<Theme>(getStoredTheme);
  const [showThemeManager, setShowThemeManager] = useState(false);
  const [density, setDensity] = useState<Density>(getStoredDensity);
  const [fontSize, setFontSize] = useState<FontSize>(getStoredFontSize);
  const [recentLimit, setRecentLimit] = useState(readRecentLimit);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(readRecentProjects);
  const [activeModal, setActiveModal] = useState<UserSettingsModal>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    setName(user?.name ?? "");
    setEmail(user?.email ?? "");
  }, [user]);

  async function handleProfileSave(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setSavingProfile(true);
    setProfileMessage("");
    setProfileError("");
    try {
      await updateProfile({ name: name.trim(), email: email.trim() });
      setProfileMessage(t("userSettings.modal.saveProfile"));
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : t("userSettings.modal.profileUpdateFailed"));
    } finally {
      setSavingProfile(false);
    }
  }

  async function handlePasswordSave(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setPasswordMessage("");
    setPasswordError("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError(t("userSettings.modal.passwordEnterCurrentAndNewTwice"));
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError(t("userSettings.modal.passwordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t("userSettings.modal.passwordsDoNotMatch"));
      return;
    }

    setSavingPassword(true);
    try {
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage(t("userSettings.modal.passwordChanged"));
    } catch (error) {
      setPasswordError(
        error instanceof Error ? error.message : t("userSettings.modal.passwordChangeFailed"),
      );
    } finally {
      setSavingPassword(false);
    }
  }

  function handleTheme(nextTheme: Theme) {
    setTheme(nextTheme);
    setActivePresetId(null);
    applyTheme(nextTheme);
  }

  function handleThemeManagerApplied() {
    setTheme(getStoredTheme());
  }

  function handleDensity(nextDensity: Density) {
    setDensity(nextDensity);
    applyDensity(nextDensity);
  }

  function handleFontSize(nextFontSize: FontSize) {
    setFontSize(nextFontSize);
    applyFontSize(nextFontSize);
  }

  function updateRecentLimit(value: number) {
    setRecentLimit(value);
    localStorage.setItem(RECENT_LIMIT_KEY, String(value));
  }

  function clearRecentProjects() {
    localStorage.removeItem(RECENT_PROJECTS_KEY);
    setRecentProjects([]);
  }

  const displayedRecent = recentProjects.slice(0, recentLimit);
  const settingsCards = [
    {
      id: "profile" as const,
      title: t("userSettings.modal.profileTitle"),
      description: t("userSettings.cards.profileDescription"),
      tone: "default" as const,
    },
    {
      id: "password" as const,
      title: t("userSettings.modal.passwordTitle"),
      description: t("userSettings.cards.passwordDescription"),
      tone: "admin" as const,
    },
    {
      id: "appearance" as const,
      title: t("userSettings.modal.appearanceTitle"),
      description: t("userSettings.cards.appearanceDescription"),
      tone: "default" as const,
    },
    {
      id: "recent" as const,
      title: t("userSettings.sections.recentProjectsTitle"),
      description: t("userSettings.sections.recentProjectsDescription"),
      tone: "default" as const,
    },
  ];

  const settingsCardById = new Map(settingsCards.map((card) => [card.id, card]));
  const userSettingsSectionDefs = [
    {
      id: "account",
      eyebrow: t("userSettings.sections.accountEyebrow"),
      title: t("userSettings.sections.accountTitle"),
      cardIds: ["profile", "password"],
    },
    {
      id: "preferences",
      eyebrow: t("userSettings.sections.preferencesEyebrow"),
      title: t("userSettings.sections.preferencesTitle"),
      cardIds: ["appearance", "recent"],
    },
  ] satisfies Array<{
    id: string;
    eyebrow: string;
    title: string;
    cardIds: Array<NonNullable<UserSettingsModal>>;
  }>;

  const userSettingsSections = userSettingsSectionDefs.map((section) => ({
    ...section,
    cards: section.cardIds.flatMap((cardId) => {
      const card = settingsCardById.get(cardId);
      return card ? [card] : [];
    }),
  }));

  return (
    <div className="view user-settings-view">
      <header className="view-header">
        <div className="view-title-with-help">
          <h1>{t("userSettings.sections.pageTitle")}</h1>
          <button type="button" className="users-help-icon-btn" onClick={() => setHelpOpen(true)} aria-label={t("userSettings.sections.openHelp")}>
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
      </header>

      <div className="app-settings-overview-shell user-settings-overview-shell">
        <div className="app-settings-overview-stack">
          <div className="app-settings-overview-sections">
            {userSettingsSections.map((section) => (
              <section key={section.id} className="app-settings-overview-section">
                <div className="app-settings-overview-section-header">
                  <p className="app-settings-overview-section-eyebrow">{section.eyebrow}</p>
                  <h2>{section.title}</h2>
                </div>

                <div className="app-settings-overview-grid">
                  {section.cards.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      className={`app-settings-overview-card app-settings-overview-card--${card.tone}`}
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

      {activeModal === "profile" && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal app-settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">{t("userSettings.modal.profileTitle")}</h2>
              </div>
              <button className="btn" type="button" onClick={() => setActiveModal(null)} disabled={savingProfile}>
                {t("userSettings.modal.close")}
              </button>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <SettingsModalSection
                  title={t("userSettings.modal.profileSectionTitle")}
                  description={t("userSettings.modal.profileSectionDescription")}
                >
                  <form className="user-settings-form" onSubmit={handleProfileSave}>
                    <label className="form-label">
                      {t("userSettings.modal.displayName")}
                      <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} disabled={savingProfile} />
                    </label>
                    <label className="form-label">
                      {t("auth.form.email")}
                      <input className="form-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={savingProfile} />
                    </label>
                    {profileError && <p className="auth-error">{profileError}</p>}
                    {profileMessage && <p className="settings-success">{profileMessage}</p>}
                    <div className="form-actions">
                      <button className="btn btn--primary" type="submit" disabled={savingProfile || !name.trim() || !email.trim()}>
                        {savingProfile ? t("userSettings.modal.saving") : t("userSettings.modal.saveProfile")}
                      </button>
                    </div>
                  </form>
                </SettingsModalSection>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button className="btn btn--primary" type="button" onClick={() => setActiveModal(null)} disabled={savingProfile}>
                {t("userSettings.modal.done")}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeModal === "password" && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal app-settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">{t("userSettings.modal.passwordTitle")}</h2>
              </div>
              <button className="btn" type="button" onClick={() => setActiveModal(null)} disabled={savingPassword}>
                {t("userSettings.modal.close")}
              </button>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <SettingsModalSection
                  title={t("userSettings.modal.passwordSectionTitle")}
                  description={t("userSettings.modal.passwordSectionDescription")}
                >
                  <form className="user-settings-form" onSubmit={handlePasswordSave}>
                    <label className="form-label">
                      {t("userSettings.modal.currentPassword")}
                      <input
                        className="form-input"
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        disabled={savingPassword}
                        autoComplete="current-password"
                      />
                    </label>
                    <label className="form-label">
                      {t("userSettings.modal.newPassword")}
                      <input
                        className="form-input"
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        disabled={savingPassword}
                        autoComplete="new-password"
                      />
                    </label>
                    <label className="form-label">
                      {t("userSettings.modal.confirmNewPassword")}
                      <input
                        className="form-input"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        disabled={savingPassword}
                        autoComplete="new-password"
                      />
                    </label>
                    {passwordError && <p className="auth-error">{passwordError}</p>}
                    {passwordMessage && <p className="settings-success">{passwordMessage}</p>}
                    <div className="form-actions">
                      <button
                        className="btn btn--primary"
                        type="submit"
                        disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}
                      >
                        {savingPassword ? t("userSettings.modal.changing") : t("userSettings.modal.changePassword")}
                      </button>
                    </div>
                  </form>
                </SettingsModalSection>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button className="btn btn--primary" type="button" onClick={() => setActiveModal(null)} disabled={savingPassword}>
                {t("userSettings.modal.done")}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeModal === "appearance" && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal app-settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">{t("userSettings.modal.appearanceTitle")}</h2>
              </div>
              <button className="btn" type="button" onClick={() => setActiveModal(null)}>
                {t("userSettings.modal.close")}
              </button>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <SettingsModalSection
                  title={t("userSettings.modal.themeSectionTitle")}
                  description={t("userSettings.modal.themeSectionDescription")}
                >
                  <div className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-label">{t("userSettings.modal.themeLabel")}</div>
                      <div className="settings-row-desc">{t("userSettings.modal.themeLabelDescription")}</div>
                    </div>
                    <div className="theme-options">
                      {(["light", "dark"] as Theme[]).map((option) => (
                        <button
                          key={option}
                          className={`theme-option${theme === option ? " theme-option--active" : ""}`}
                          onClick={() => handleTheme(option)}
                          aria-pressed={theme === option}
                          type="button"
                        >
                          <div className={`theme-preview theme-preview--${option}`}>
                            <div className="theme-preview-sidebar" />
                            <div className="theme-preview-content">
                              <div className="theme-preview-bar" style={{ width: "70%" }} />
                              <div className="theme-preview-bar" style={{ width: "50%" }} />
                              <div className="theme-preview-bar" style={{ width: "60%" }} />
                            </div>
                          </div>
                          {option === "light" ? t("userSettings.modal.light") : t("userSettings.modal.dark")}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-label">{t("userSettings.modal.customTheme")}</div>
                      <div className="settings-row-desc">{t("userSettings.modal.customThemeDescription")}</div>
                    </div>
                    <button className="btn" type="button" onClick={() => setShowThemeManager(true)}>
                      {t("userSettings.modal.editTheme")}
                    </button>
                  </div>
                </SettingsModalSection>

                <SettingsModalSection
                  title={t("userSettings.modal.layoutTitle")}
                  description={t("userSettings.modal.layoutDescription")}
                >
                  <div className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-label">{t("userSettings.modal.interfaceDensity")}</div>
                      <div className="settings-row-desc">{t("userSettings.modal.interfaceDensityDescription")}</div>
                    </div>
                    <div className="segmented-control">
                      {(["comfortable", "compact"] as Density[]).map((option) => (
                        <button
                          key={option}
                          className={density === option ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                          onClick={() => handleDensity(option)}
                          type="button"
                        >
                          {option === "comfortable" ? t("userSettings.modal.comfortable") : t("userSettings.modal.compact")}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-label">{t("userSettings.modal.textSize")}</div>
                      <div className="settings-row-desc">{t("userSettings.modal.textSizeDescription")}</div>
                    </div>
                    <div className="segmented-control">
                      {(["small", "normal", "large"] as FontSize[]).map((option) => (
                        <button
                          key={option}
                          className={fontSize === option ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                          onClick={() => handleFontSize(option)}
                          type="button"
                        >
                          {option === "small"
                            ? t("userSettings.modal.small")
                            : option === "normal"
                              ? t("userSettings.modal.normal")
                              : t("userSettings.modal.large")}
                        </button>
                      ))}
                    </div>
                  </div>
                </SettingsModalSection>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button className="btn btn--primary" type="button" onClick={() => setActiveModal(null)}>
                {t("userSettings.modal.done")}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeModal === "recent" && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal app-settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">{t("userSettings.sections.recentProjectsTitle")}</h2>
              </div>
              <button className="btn" type="button" onClick={() => setActiveModal(null)}>
                {t("userSettings.modal.close")}
              </button>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <SettingsModalSection
                  title={t("userSettings.modal.recentProjectsSectionTitle")}
                  description={t("userSettings.modal.recentProjectsSectionDescription")}
                >
                  <div className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-label">{t("userSettings.modal.projectsToShow")}</div>
                      <div className="settings-row-desc">{t("userSettings.modal.projectsToShowDescription")}</div>
                    </div>
                    <select className="form-input user-settings-select" value={recentLimit} onChange={(e) => updateRecentLimit(Number(e.target.value))}>
                      {[5, 10, 15, 25].map((limit) => <option key={limit} value={limit}>{limit}</option>)}
                    </select>
                  </div>

                  {displayedRecent.length === 0 ? (
                    <div className="settings-empty">{t("userSettings.modal.noRecentProjects")}</div>
                  ) : (
                    <div className="recent-projects-list">
                      {displayedRecent.map((recent) => {
                        const project = projects.find((p) => p.id === recent.id);
                        return (
                          <button
                            key={recent.id}
                            className="recent-project-row"
                            type="button"
                            disabled={!project}
                            onClick={() => project && openProject(project, activeProject)}
                          >
                            <span>
                              <strong>{recent.name}</strong>
                              <small>{project ? t("userSettings.modal.openedAt", { value: fmtRecentDate(recent.openedAt) }) : t("userSettings.modal.projectUnavailable")}</small>
                            </span>
                            {project && <span className="recent-project-open">{t("common.open")}</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="form-actions">
                    <button className="btn" type="button" onClick={clearRecentProjects} disabled={recentProjects.length === 0}>
                      {t("userSettings.modal.clearHistory")}
                    </button>
                  </div>
                </SettingsModalSection>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button className="btn btn--primary" type="button" onClick={() => setActiveModal(null)}>
                {t("userSettings.modal.done")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showThemeManager && (
        <ThemeManagerModal
          onClose={() => setShowThemeManager(false)}
          onApplied={handleThemeManagerApplied}
        />
      )}

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal modal--help" onClick={(e) => e.stopPropagation()}>
            <h2>{t("userSettings.help.title")}</h2>
            <div className="app-settings-modal-body">
                <ul className="settings-help-list">
                  <li>{t("userSettings.help.line1")}</li>
                  <li>{t("userSettings.help.line2")}</li>
                </ul>
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setHelpOpen(false)}>
                  {t("userSettings.modal.close")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
