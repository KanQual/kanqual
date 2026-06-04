import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../context/AuthContext";
import { useStore } from "../context/StoreContext";
import { ThemeManagerModal } from "./App_Settings_View";
import { HelpIcon } from "../components/AppIcons";
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
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function UserSettingsView() {
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
      setProfileMessage("Profile saved.");
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Profile update failed.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handlePasswordSave(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setPasswordMessage("");
    setPasswordError("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError("Enter your current password and the new password twice.");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }

    setSavingPassword(true);
    try {
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("Password changed.");
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "Password change failed.");
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
      title: "Profile",
      description: "Update the name and email shown in logs, coding, and reports.",
      tone: "default" as const,
    },
    {
      id: "password" as const,
      title: "Password",
      description: "Change the password used to sign in to this account.",
      tone: "admin" as const,
    },
    {
      id: "appearance" as const,
      title: "Appearance",
      description: "Control theme, density, and text size on this device.",
      tone: "default" as const,
    },
    {
      id: "recent" as const,
      title: "Recent Projects",
      description: "Manage the locally remembered projects shown on this device.",
      tone: "default" as const,
    },
  ];

  const settingsCardById = new Map(settingsCards.map((card) => [card.id, card]));
  const userSettingsSectionDefs = [
    {
      id: "account",
      eyebrow: "Account",
      title: "Manage the identity and security details that belong to you.",
      cardIds: ["profile", "password"],
    },
    {
      id: "preferences",
      eyebrow: "Preferences",
      title: "Adjust the way Kanqual looks and feels on this device.",
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
          <h1>User Settings</h1>
          <button type="button" className="users-help-icon-btn" onClick={() => setHelpOpen(true)} aria-label="Open user settings help">
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
                <h2 className="settings-section-title">Profile</h2>
              </div>
              <button className="btn" type="button" onClick={() => setActiveModal(null)} disabled={savingProfile}>
                Close
              </button>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <SettingsModalSection
                  title="Account Identity"
                  description="Update the personal name and email that Kanqual uses for logs, coding attribution, and reports."
                >
                  <form className="user-settings-form" onSubmit={handleProfileSave}>
                    <label className="form-label">
                      Display name
                      <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} disabled={savingProfile} />
                    </label>
                    <label className="form-label">
                      Email
                      <input className="form-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={savingProfile} />
                    </label>
                    {profileError && <p className="auth-error">{profileError}</p>}
                    {profileMessage && <p className="settings-success">{profileMessage}</p>}
                    <div className="form-actions">
                      <button className="btn btn--primary" type="submit" disabled={savingProfile || !name.trim() || !email.trim()}>
                        {savingProfile ? "Saving..." : "Save Profile"}
                      </button>
                    </div>
                  </form>
                </SettingsModalSection>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button className="btn btn--primary" type="button" onClick={() => setActiveModal(null)} disabled={savingProfile}>
                Done
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
                <h2 className="settings-section-title">Change Password</h2>
              </div>
              <button className="btn" type="button" onClick={() => setActiveModal(null)} disabled={savingPassword}>
                Close
              </button>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <SettingsModalSection
                  title="Password Security"
                  description="Enter your current password, then set the new password you want this account to use going forward."
                >
                  <form className="user-settings-form" onSubmit={handlePasswordSave}>
                    <label className="form-label">
                      Current password
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
                      New password
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
                      Confirm new password
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
                        {savingPassword ? "Changing..." : "Change Password"}
                      </button>
                    </div>
                  </form>
                </SettingsModalSection>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button className="btn btn--primary" type="button" onClick={() => setActiveModal(null)} disabled={savingPassword}>
                Done
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
                <h2 className="settings-section-title">Theme & Appearance</h2>
              </div>
              <button className="btn" type="button" onClick={() => setActiveModal(null)}>
                Close
              </button>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <SettingsModalSection
                  title="Theme"
                  description="Choose the overall light or dark interface you want this device to use."
                >
                  <div className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-label">Theme</div>
                      <div className="settings-row-desc">Switch between the light and dark interface.</div>
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
                          {option === "light" ? "Light" : "Dark"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-label">Custom Theme</div>
                      <div className="settings-row-desc">Edit colors, corner radius, and border width, or choose a saved theme preset.</div>
                    </div>
                    <button className="btn" type="button" onClick={() => setShowThemeManager(true)}>
                      Edit Theme...
                    </button>
                  </div>
                </SettingsModalSection>

                <SettingsModalSection
                  title="Workspace Layout"
                  description="Adjust spacing and text size to make longer coding or reading sessions more comfortable on this device."
                >
                  <div className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-label">Interface density</div>
                      <div className="settings-row-desc">Choose roomier spacing or a more compact workspace.</div>
                    </div>
                    <div className="segmented-control">
                      {(["comfortable", "compact"] as Density[]).map((option) => (
                        <button
                          key={option}
                          className={density === option ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                          onClick={() => handleDensity(option)}
                          type="button"
                        >
                          {option === "comfortable" ? "Comfortable" : "Compact"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-label">Text size</div>
                      <div className="settings-row-desc">Tune the overall reading size for long coding sessions.</div>
                    </div>
                    <div className="segmented-control">
                      {(["small", "normal", "large"] as FontSize[]).map((option) => (
                        <button
                          key={option}
                          className={fontSize === option ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                          onClick={() => handleFontSize(option)}
                          type="button"
                        >
                          {option[0].toUpperCase() + option.slice(1)}
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
                Done
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
                <h2 className="settings-section-title">Recent Projects</h2>
              </div>
              <button className="btn" type="button" onClick={() => setActiveModal(null)}>
                Close
              </button>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <SettingsModalSection
                  title="Recent Project List"
                  description="Control how many recently opened projects Kanqual keeps visible on this device and reopen them from here when available."
                >
                  <div className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-label">Projects to show</div>
                      <div className="settings-row-desc">Limit how many recent projects appear in this list.</div>
                    </div>
                    <select className="form-input user-settings-select" value={recentLimit} onChange={(e) => updateRecentLimit(Number(e.target.value))}>
                      {[5, 10, 15, 25].map((limit) => <option key={limit} value={limit}>{limit}</option>)}
                    </select>
                  </div>

                  {displayedRecent.length === 0 ? (
                    <div className="settings-empty">No recent projects yet.</div>
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
                              <small>{project ? `Opened ${fmtRecentDate(recent.openedAt)}` : "Project unavailable"}</small>
                            </span>
                            {project && <span className="recent-project-open">Open</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="form-actions">
                    <button className="btn" type="button" onClick={clearRecentProjects} disabled={recentProjects.length === 0}>
                      Clear History
                    </button>
                  </div>
                </SettingsModalSection>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button className="btn btn--primary" type="button" onClick={() => setActiveModal(null)}>
                Done
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
            <h2>User Settings Help</h2>
            <div className="app-settings-modal-body">
                <ul className="settings-help-list">
                  <li>Use User Settings for personal account and preference changes that belong to the signed-in person rather than the shared project or host device.</li>
                  <li>Changes here are personal unless they update your shared account identity, such as name or email.</li>
                </ul>
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setHelpOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
