import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useStore } from "../context/StoreContext";
import {
  applyDensity,
  applyFontSize,
  applyTheme,
  getStoredDensity,
  getStoredFontSize,
  getStoredTheme,
  type Density,
  type FontSize,
  type Theme,
} from "../theme";

type CodingPrefs = {
  keepLastCodeActive: boolean;
  promptForAnnotationNote: boolean;
  autoOpenCodePicker: boolean;
  showCodeDescriptions: boolean;
};

type RecentProject = {
  id: string;
  name: string;
  description?: string;
  openedAt: string;
};

const CODING_PREFS_KEY = "kq_coding_preferences";
const RECENT_PROJECTS_KEY = "kq_recent_projects";
const RECENT_LIMIT_KEY = "kq_recent_project_limit";

const DEFAULT_CODING_PREFS: CodingPrefs = {
  keepLastCodeActive: false,
  promptForAnnotationNote: false,
  autoOpenCodePicker: true,
  showCodeDescriptions: true,
};

function readCodingPrefs(): CodingPrefs {
  try {
    return { ...DEFAULT_CODING_PREFS, ...JSON.parse(localStorage.getItem(CODING_PREFS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_CODING_PREFS;
  }
}

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
  const { user, updateProfile } = useAuth();
  const { projects, openProject, activeProject } = useStore();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState("");
  const [theme, setTheme] = useState<Theme>(getStoredTheme);
  const [density, setDensity] = useState<Density>(getStoredDensity);
  const [fontSize, setFontSize] = useState<FontSize>(getStoredFontSize);
  const [codingPrefs, setCodingPrefs] = useState<CodingPrefs>(readCodingPrefs);
  const [recentLimit, setRecentLimit] = useState(readRecentLimit);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(readRecentProjects);

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

  function handleTheme(nextTheme: Theme) {
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }

  function handleDensity(nextDensity: Density) {
    setDensity(nextDensity);
    applyDensity(nextDensity);
  }

  function handleFontSize(nextFontSize: FontSize) {
    setFontSize(nextFontSize);
    applyFontSize(nextFontSize);
  }

  function updateCodingPref(key: keyof CodingPrefs, value: boolean) {
    const next = { ...codingPrefs, [key]: value };
    setCodingPrefs(next);
    localStorage.setItem(CODING_PREFS_KEY, JSON.stringify(next));
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

  return (
    <div className="view user-settings-view">
      <header className="view-header">
        <h1>User Settings</h1>
      </header>

      <section className="settings-section settings-section--wide">
        <div className="settings-section-header">
          <div>
            <h2 className="settings-section-title">Profile</h2>
            <p className="settings-section-desc">Control the name and email shown in logs, coding, and reports.</p>
          </div>
        </div>

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
      </section>

      <section className="settings-section settings-section--wide">
        <div className="settings-section-header">
          <div>
            <h2 className="settings-section-title">Theme & Appearance</h2>
            <p className="settings-section-desc">Personal display preferences for this device.</p>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">Theme</div>
            <div className="settings-row-desc">Switch between the light and dark interface.</div>
          </div>
          <div className="segmented-control">
            {(["light", "dark"] as Theme[]).map((option) => (
              <button
                key={option}
                className={theme === option ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                onClick={() => handleTheme(option)}
                type="button"
              >
                {option === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
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
      </section>

      <section className="settings-section settings-section--wide">
        <div className="settings-section-header">
          <div>
            <h2 className="settings-section-title">Coding Preferences</h2>
            <p className="settings-section-desc">Saved workflow defaults for annotation-heavy work.</p>
          </div>
        </div>

        <label className="settings-toggle-row">
          <span>
            <strong>Auto-open code picker</strong>
            <small>Show code choices immediately when text is selected.</small>
          </span>
          <input type="checkbox" checked={codingPrefs.autoOpenCodePicker} onChange={(e) => updateCodingPref("autoOpenCodePicker", e.target.checked)} />
        </label>
        <label className="settings-toggle-row">
          <span>
            <strong>Keep last code active</strong>
            <small>Prepare the previous code for repeated coding passes.</small>
          </span>
          <input type="checkbox" checked={codingPrefs.keepLastCodeActive} onChange={(e) => updateCodingPref("keepLastCodeActive", e.target.checked)} />
        </label>
        <label className="settings-toggle-row">
          <span>
            <strong>Prompt for annotation notes</strong>
            <small>Ask for a note after creating an annotation.</small>
          </span>
          <input type="checkbox" checked={codingPrefs.promptForAnnotationNote} onChange={(e) => updateCodingPref("promptForAnnotationNote", e.target.checked)} />
        </label>
        <label className="settings-toggle-row">
          <span>
            <strong>Show code descriptions while coding</strong>
            <small>Keep code definitions visible when choosing a code.</small>
          </span>
          <input type="checkbox" checked={codingPrefs.showCodeDescriptions} onChange={(e) => updateCodingPref("showCodeDescriptions", e.target.checked)} />
        </label>
      </section>

      <section className="settings-section settings-section--wide">
        <div className="settings-section-header">
          <div>
            <h2 className="settings-section-title">Recent Projects</h2>
            <p className="settings-section-desc">Projects are remembered locally on this device when opened.</p>
          </div>
          <button className="btn" type="button" onClick={clearRecentProjects} disabled={recentProjects.length === 0}>
            Clear History
          </button>
        </div>

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
      </section>
    </div>
  );
}
