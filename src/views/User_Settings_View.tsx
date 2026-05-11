import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useStore } from "../context/StoreContext";
import { ThemeManagerModal } from "./App_Settings_View";
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
    },
    {
      id: "password" as const,
      title: "Password",
      description: "Change the password used to sign in to this account.",
    },
    {
      id: "appearance" as const,
      title: "Appearance",
      description: "Control theme, density, and text size on this device.",
    },
    {
      id: "recent" as const,
      title: "Recent Projects",
      description: "Manage the locally remembered projects shown on this device.",
    },
  ];

  return (
    <div className="view user-settings-view">
      <header className="view-header">
        <h1>User Settings</h1>
      </header>

      <div className="app-settings-overview-shell user-settings-overview-shell">
        <div className="app-settings-overview-stack">
          <div className="app-settings-overview-grid">
            {settingsCards.map((card) => (
              <button
                key={card.id}
                type="button"
                className="app-settings-overview-card"
                onClick={() => setActiveModal(card.id)}
              >
                <h3>{card.title}</h3>
                <p>{card.description}</p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {activeModal === "profile" && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal app-settings-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Profile</h2>
            <div className="app-settings-modal-body">
              <p className="settings-section-desc">Control the name and email shown in logs, coding, and reports.</p>
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
                  <button className="btn" type="button" onClick={() => setActiveModal(null)} disabled={savingProfile}>
                    Close
                  </button>
                  <button className="btn btn--primary" type="submit" disabled={savingProfile || !name.trim() || !email.trim()}>
                    {savingProfile ? "Saving..." : "Save Profile"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {activeModal === "password" && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal app-settings-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Change Password</h2>
            <div className="app-settings-modal-body">
              <p className="settings-section-desc">Update the password used to sign in to this account.</p>
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
                  <button className="btn" type="button" onClick={() => setActiveModal(null)} disabled={savingPassword}>
                    Close
                  </button>
                  <button
                    className="btn btn--primary"
                    type="submit"
                    disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}
                  >
                    {savingPassword ? "Changing..." : "Change Password"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {activeModal === "appearance" && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal app-settings-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Theme & Appearance</h2>
            <div className="app-settings-modal-body">
              <p className="settings-section-desc">Personal display preferences for this device.</p>

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

              <div className="form-actions">
                <button className="btn" type="button" onClick={() => setActiveModal(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeModal === "recent" && (
        <div className="modal-overlay" onClick={() => setActiveModal(null)}>
          <div className="modal app-settings-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Recent Projects</h2>
            <div className="app-settings-modal-body">
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
                <button className="btn" type="button" onClick={() => setActiveModal(null)}>
                  Close
                </button>
                <button className="btn" type="button" onClick={clearRecentProjects} disabled={recentProjects.length === 0}>
                  Clear History
                </button>
              </div>
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
    </div>
  );
}
