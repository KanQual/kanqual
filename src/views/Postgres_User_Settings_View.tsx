import { useCallback, useEffect, useState } from "react";
import { SettingsModal } from "../components/SettingsModal";
import { ThemeManagerModal } from "../components/ThemeManagerModal";
import { LOCALE_LABELS, SUPPORTED_LOCALES } from "../i18n";
import { useI18n } from "../i18n/provider";
import {
  changePostgresAppUserPassword,
  getPostgresUserPreferences,
  renamePostgresRememberedAccount,
  savePostgresUserPreferences,
  updatePostgresAppUserProfile,
  type PostgresAuthSession,
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

export type PostgresUserSettingsViewProps = {
  authSession: PostgresAuthSession;
  onAuthSessionUpdated: (session: PostgresAuthSession) => void;
  onAuthSessionInvalidated: () => void;
  embedded?: boolean;
  includeAppearance?: boolean;
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

function applyPostgresRuntimeThemePreferences(preferences: PostgresUserPreferences): void {
  setRuntimeThemePreferences({
    theme: preferences.theme,
    density: preferences.density,
    fontSize: preferences.fontSize,
    themeState: preferences.themeState,
  });
  initTheme();
}

export function PostgresUserSettingsView({
  authSession,
  onAuthSessionUpdated,
  onAuthSessionInvalidated,
  embedded = false,
  includeAppearance = true,
}: PostgresUserSettingsViewProps) {
  const { locale, setLocale } = useI18n();
  const [activeModal, setActiveModal] = useState<"profile" | "password" | "appearance" | null>(null);
  const [showThemeManager, setShowThemeManager] = useState(false);
  const [name, setName] = useState(authSession.user.name);
  const [email, setEmail] = useState(authSession.user.email);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState<"profile" | "password" | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [theme, setTheme] = useState<Theme>("light");
  const [density, setDensity] = useState<Density>("comfortable");
  const [fontSize, setFontSize] = useState<FontSize>("normal");
  const [recentProjectLimit, setRecentProjectLimit] = useState(10);

  useEffect(() => {
    setName(authSession.user.name);
    setEmail(authSession.user.email);
  }, [authSession.user.email, authSession.user.name]);

  useEffect(() => {
    let cancelled = false;

    async function loadUserPreferences() {
      try {
        const nextPreferences = await getPostgresUserPreferences();
        if (cancelled) return;
        setTheme(nextPreferences.theme);
        setDensity(nextPreferences.density);
        setFontSize(nextPreferences.fontSize);
        setRecentProjectLimit(nextPreferences.recentProjectLimit);
        if (nextPreferences.locale !== locale) {
          setLocale(nextPreferences.locale);
        }
        applyPostgresRuntimeThemePreferences(nextPreferences);
        setActivePresetId(null);
      } catch (loadError) {
        if (!cancelled) {
          setError(describeUnknownError(loadError));
        }
      }
    }

    void loadUserPreferences();
    return () => {
      cancelled = true;
    };
  }, [authSession.authKind, authSession.user.id, locale, setLocale]);

  const persistUserPreferences = useCallback(async (
    next: PostgresUserPreferences,
    successMessage?: string,
  ) => {
    const saved = await savePostgresUserPreferences(next);
    setTheme(saved.theme);
    setDensity(saved.density);
    setFontSize(saved.fontSize);
    setRecentProjectLimit(saved.recentProjectLimit);
    applyPostgresRuntimeThemePreferences(saved);
    if (successMessage) setNotice(successMessage);
    setError("");
  }, []);

  async function handleSaveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (authSession.authKind !== "app_user") {
      setError("The built-in local administrator account is managed through PostgreSQL setup, not this profile form.");
      return;
    }
    if (!name.trim() || !email.trim()) {
      setError("Enter your name and email.");
      return;
    }

    setSubmitting("profile");
    try {
      const previousEmail = authSession.user.email;
      const updatedUser = await updatePostgresAppUserProfile({
        name: name.trim(),
        email: email.trim(),
      });
      await renamePostgresRememberedAccount(previousEmail, updatedUser.email, updatedUser.name);
      onAuthSessionUpdated({
        ...authSession,
        user: updatedUser,
      });
      setNotice("Profile updated.");
      setActiveModal(null);
    } catch (updateError) {
      setError(describeUnknownError(updateError));
    } finally {
      setSubmitting(null);
    }
  }

  async function handleChangePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (authSession.authKind !== "app_user") {
      setError("The built-in local administrator password is managed through PostgreSQL setup, not this form.");
      return;
    }
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("Enter your current password and the new password twice.");
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

    setSubmitting("password");
    try {
      await changePostgresAppUserPassword({
        currentPassword,
        newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNotice("Password changed. Sign in again to continue.");
      setActiveModal(null);
      onAuthSessionInvalidated();
    } catch (changeError) {
      setError(describeUnknownError(changeError));
    } finally {
      setSubmitting(null);
    }
  }

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

  async function handleLocaleChange(nextLocale: (typeof SUPPORTED_LOCALES)[number]) {
    setLocale(nextLocale);
    try {
      await persistUserPreferences({
        theme,
        density,
        fontSize,
        locale: nextLocale,
        recentProjectLimit,
        themeState: getStoredThemeState(),
      }, "Language updated.");
    } catch (changeError) {
      setError(describeUnknownError(changeError));
    }
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
    <div className={embedded ? "user-settings-view user-settings-view--embedded" : "view user-settings-view"}>
      {!embedded ? (
        <header className="view-header">
          <div className="view-title-with-help">
            <h1>User Settings</h1>
          </div>
        </header>
      ) : null}

      {notice ? <p className="settings-success">{notice}</p> : null}
      {error ? <p className="auth-error">{error}</p> : null}

      <div className="app-settings-overview-shell user-settings-overview-shell">
        <div className="app-settings-overview-stack">
          <div className="app-settings-overview-sections">
            <section className="app-settings-overview-section">
              {!embedded ? (
                <div className="app-settings-overview-section-header">
                  <p className="app-settings-overview-section-heading">Account</p>
                </div>
              ) : null}
              <div className="app-settings-overview-grid">
                <button
                  type="button"
                  className="app-settings-overview-card app-settings-overview-card--default"
                  onClick={() => setActiveModal("profile")}
                >
                  <h3>Profile</h3>
                  <p>Update your display name. Email is your PostgreSQL login username.</p>
                </button>
                {authSession.authKind !== "postgres_admin" ? (
                  <button
                    type="button"
                    className="app-settings-overview-card app-settings-overview-card--default"
                    onClick={() => setActiveModal("password")}
                  >
                    <h3>Password</h3>
                    <p>Change your PostgreSQL account password.</p>
                  </button>
                ) : null}
              </div>
            </section>
            {includeAppearance ? (
              <section className="app-settings-overview-section">
                {!embedded ? (
                  <div className="app-settings-overview-section-header">
                    <p className="app-settings-overview-section-heading">Preferences</p>
                  </div>
                ) : null}
                <div className="app-settings-overview-grid">
                  <button
                    type="button"
                    className="app-settings-overview-card app-settings-overview-card--default"
                    onClick={() => setActiveModal("appearance")}
                  >
                    <h3>Appearance</h3>
                    <p>Adjust theme, density, and text size for this device.</p>
                  </button>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </div>

      {activeModal === "profile" ? (
        <SettingsModal title="Profile" onClose={() => setActiveModal(null)} closeDisabled={submitting === "profile"}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default"><h3>PostgreSQL App User</h3></div>
                  <div className="app-settings-modal-section-body">
                    <form className="form" onSubmit={handleSaveProfile}>
                      <label className="form-label">Name
                        <input className="form-input" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
                      </label>
                      <label className="form-label">Email
                        <input className="form-input" type="email" value={email} readOnly />
                      </label>
                      <div className="form-actions">
                        <button type="button" className="btn" onClick={() => setActiveModal(null)} disabled={submitting === "profile"}>Cancel</button>
                        <button type="submit" className="btn btn--primary" disabled={submitting === "profile" || !name.trim() || !email.trim()}>
                          {submitting === "profile" ? "Saving..." : "Save profile"}
                        </button>
                      </div>
                    </form>
                  </div>
                </section>
              </div>
            </div>
        </SettingsModal>
      ) : null}

      {activeModal === "password" ? (
        <SettingsModal title="Password" onClose={() => setActiveModal(null)} closeDisabled={submitting === "password"}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default"><h3>Change Password</h3></div>
                  <div className="app-settings-modal-section-body">
                    <form className="form" onSubmit={handleChangePassword}>
                      <label className="form-label">Current password
                        <input className="form-input" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoFocus />
                      </label>
                      <label className="form-label">New password
                        <input className="form-input" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
                        <p className="password-requirement-note">Minimum 8 characters.</p>
                      </label>
                      <label className="form-label">Confirm new password
                        <input className="form-input" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
                      </label>
                      <div className="form-actions">
                        <button type="button" className="btn" onClick={() => setActiveModal(null)} disabled={submitting === "password"}>Cancel</button>
                        <button type="submit" className="btn btn--primary" disabled={submitting === "password"}>
                          {submitting === "password" ? "Changing..." : "Change password"}
                        </button>
                      </div>
                    </form>
                  </div>
                </section>
              </div>
            </div>
        </SettingsModal>
      ) : null}

      {activeModal === "appearance" ? (
        <SettingsModal title="Appearance" onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default"><h3>Interface</h3></div>
                  <div className="app-settings-modal-section-body">
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <div className="settings-row-label">Theme</div>
                        <div className="settings-row-desc">Switch between light and dark mode.</div>
                      </div>
                      <div className="theme-options">
                        {(["light", "dark"] as Theme[]).map((option) => (
                          <button key={option} type="button" className={`theme-option${theme === option ? " theme-option--active" : ""}`} onClick={() => handleTheme(option)}>
                            {option === "light" ? "Light" : "Dark"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <div className="settings-row-label">Interface density</div>
                        <div className="settings-row-desc">Choose a more spacious or compact layout.</div>
                      </div>
                      <div className="segmented-control">
                        {(["comfortable", "compact"] as Density[]).map((option) => (
                          <button
                            key={option}
                            type="button"
                            className={density === option ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                            onClick={() => handleDensity(option)}
                          >
                            {option === "comfortable" ? "Comfortable" : "Compact"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <div className="settings-row-label">Text size</div>
                        <div className="settings-row-desc">Adjust default interface text size.</div>
                      </div>
                      <div className="segmented-control">
                        {(["small", "normal", "large"] as FontSize[]).map((option) => (
                          <button
                            key={option}
                            type="button"
                            className={fontSize === option ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                            onClick={() => handleFontSize(option)}
                          >
                            {option === "small" ? "Small" : option === "normal" ? "Normal" : "Large"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <div className="settings-row-label">Language</div>
                        <div className="settings-row-desc">Choose the interface language for this account on this device.</div>
                      </div>
                      <select className="form-input" value={locale} onChange={(event) => void handleLocaleChange(event.target.value as (typeof SUPPORTED_LOCALES)[number])}>
                        {SUPPORTED_LOCALES.map((option) => (
                          <option key={option} value={option}>{LOCALE_LABELS[option]}</option>
                        ))}
                      </select>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <div className="settings-row-label">Custom theme</div>
                        <div className="settings-row-desc">Edit saved presets, color overrides, corner radius, and border width for this device.</div>
                      </div>
                      <button type="button" className="btn" onClick={() => setShowThemeManager(true)}>Edit theme</button>
                    </div>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button>
            </div>
        </SettingsModal>
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
