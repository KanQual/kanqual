import { useCallback, useEffect, useState } from "react";
import { ActiveThemePreviewRow } from "../components/ActiveThemePreviewRow";
import { SettingsModal } from "../components/SettingsModal";
import { ThemeManagerModal } from "../components/ThemeManagerModal";
import { LOCALE_LABELS, SUPPORTED_LOCALES } from "../i18n";
import { useI18n } from "../i18n/provider";
import {
  changePostgresAppUserPassword,
  getPostgresUserPreferences,
  savePostgresUserPreferences,
  type PostgresAuthSession,
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
import {
  normalizeSourceTextSizePx,
  SOURCE_TEXT_SIZE_STEP_PX,
  TextSizeControls,
} from "./Postgres_Source_Coding_Shared";

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

function accountInitials(name: string): string {
  return (name || "?")
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function PostgresUserSettingsView({
  authSession,
  onAuthSessionInvalidated,
  embedded = false,
  includeAppearance = true,
}: PostgresUserSettingsViewProps) {
  const { locale, setLocale } = useI18n();
  const [activeModal, setActiveModal] = useState<"profile" | "password" | "appearance" | null>(null);
  const [showThemeManager, setShowThemeManager] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPasswordVisible, setCurrentPasswordVisible] = useState(false);
  const [newPasswordVisible, setNewPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [submitting, setSubmitting] = useState<"password" | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [theme, setTheme] = useState<Theme>("light");
  const [density, setDensity] = useState<Density>("comfortable");
  const [fontSize, setFontSize] = useState<FontSize>("normal");
  const [sourceTextSizePx, setSourceTextSizePx] = useState(15);
  const [recentProjectLimit, setRecentProjectLimit] = useState(10);

  useEffect(() => {
    let cancelled = false;

    async function loadUserPreferences() {
      try {
        const nextPreferences = await getPostgresUserPreferences();
        if (cancelled) return;
        setTheme(nextPreferences.theme);
        setDensity(nextPreferences.density);
        setFontSize(nextPreferences.fontSize);
        setSourceTextSizePx(normalizeSourceTextSizePx(nextPreferences.sourceTextSizePx));
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
    setSourceTextSizePx(normalizeSourceTextSizePx(saved.sourceTextSizePx));
    setRecentProjectLimit(saved.recentProjectLimit);
    applyPostgresRuntimeThemePreferences(saved);
    if (successMessage) setNotice(successMessage);
    setError("");
  }, []);

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
      resetPasswordForm();
      setNotice("Password changed. Sign in again to continue.");
      setActiveModal(null);
      onAuthSessionInvalidated();
    } catch (changeError) {
      setError(describeUnknownError(changeError));
    } finally {
      setSubmitting(null);
    }
  }

  function resetPasswordForm() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setCurrentPasswordVisible(false);
    setNewPasswordVisible(false);
    setConfirmPasswordVisible(false);
  }

  function openPasswordModal() {
    resetPasswordForm();
    setError("");
    setNotice("");
    setActiveModal("password");
  }

  const profileName = authSession.user.name || authSession.user.username;
  const profileUsername = authSession.user.username;

  function handleDensity(nextDensity: Density) {
    setDensity(nextDensity);
    applyDensity(nextDensity);
    void persistUserPreferences({
      theme,
      density: nextDensity,
      fontSize,
      sourceTextSizePx,
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
      sourceTextSizePx,
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
        sourceTextSizePx,
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
    await persistUserPreferences({
      theme: nextTheme,
      density,
      fontSize,
      sourceTextSizePx,
      locale,
      recentProjectLimit,
      themeState: getStoredThemeState(),
    }, "Theme updated.");
  }

  function handleSourceTextSize(nextTextSizePx: number) {
    const normalized = normalizeSourceTextSizePx(nextTextSizePx);
    setSourceTextSizePx(normalized);
    void persistUserPreferences({
      theme,
      density,
      fontSize,
      sourceTextSizePx: normalized,
      locale,
      recentProjectLimit,
      themeState: getStoredThemeState(),
    });
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
        <div className={embedded ? "app-settings-overview-stack app-settings-overview-stack--compact" : "app-settings-overview-stack"}>
          <div className="app-settings-overview-sections">
            <section className={embedded ? "app-settings-overview-section app-settings-overview-section--compact" : "app-settings-overview-section"}>
              {!embedded ? (
                <div className="app-settings-overview-section-header">
                  <p className="app-settings-overview-section-heading">Account</p>
                </div>
              ) : null}
              <div className={embedded ? "app-settings-overview-grid app-settings-overview-grid--compact" : "app-settings-overview-grid"}>
                <button
                  type="button"
                  className={embedded ? "app-settings-overview-card app-settings-overview-card--compact app-settings-overview-card--default" : "app-settings-overview-card app-settings-overview-card--default"}
                  onClick={() => setActiveModal("profile")}
                >
                  {embedded ? <span className="app-settings-overview-card-icon" aria-hidden="true">ID</span> : null}
                  <h3>Profile</h3>
                  {!embedded ? <p>View your KanQual account.</p> : null}
                </button>
              </div>
            </section>
            {includeAppearance ? (
              <section className={embedded ? "app-settings-overview-section app-settings-overview-section--compact" : "app-settings-overview-section"}>
                {!embedded ? (
                  <div className="app-settings-overview-section-header">
                    <p className="app-settings-overview-section-heading">Preferences</p>
                  </div>
                ) : null}
                <div className={embedded ? "app-settings-overview-grid app-settings-overview-grid--compact" : "app-settings-overview-grid"}>
                  <button
                    type="button"
                    className={embedded ? "app-settings-overview-card app-settings-overview-card--compact app-settings-overview-card--default" : "app-settings-overview-card app-settings-overview-card--default"}
                    onClick={() => setActiveModal("appearance")}
                  >
                    {embedded ? <span className="app-settings-overview-card-icon" aria-hidden="true">Aa</span> : null}
                    <h3>Appearance</h3>
                    {!embedded ? <p>Adjust theme, density, and text size for this device.</p> : null}
                  </button>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </div>

      {activeModal === "profile" ? (
        <SettingsModal title="Profile" onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-body">
                    <div className="form">
                      <div className="auth-admin-notice auth-user-notice">
                        <div className="account-avatar" aria-hidden="true">
                          {accountInitials(profileName)}
                        </div>
                        <div className="account-info">
                          <div className="account-name">{profileName}</div>
                          <div className="account-email">{profileUsername}</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn"
                        style={{ alignSelf: "flex-start" }}
                        onClick={openPasswordModal}
                        disabled={authSession.authKind !== "app_user"}
                      >
                        Change password
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <div className="form-actions" style={{ margin: 0 }}>
                <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button>
              </div>
            </div>
        </SettingsModal>
      ) : null}

      {activeModal === "password" ? (
        <SettingsModal title="Change Password" onClose={() => {
          if (submitting === "password") return;
          resetPasswordForm();
          setActiveModal(null);
        }} closeDisabled={submitting === "password"}>
          <form className="form" onSubmit={handleChangePassword}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-body">
                      <div className="auth-admin-notice auth-user-notice">
                        <div className="account-avatar" aria-hidden="true">
                          {accountInitials(profileName)}
                        </div>
                        <div className="account-info">
                          <div className="account-name">{profileName}</div>
                          <div className="account-email">{profileUsername}</div>
                        </div>
                      </div>
                      <label className="form-label" style={{ marginTop: 8 }}>Current password
                        <div className="password-input-wrap">
                          <input
                            className="form-input password-input-field"
                            type={currentPasswordVisible ? "text" : "password"}
                            value={currentPassword}
                            onChange={(event) => setCurrentPassword(event.target.value)}
                            autoFocus
                            autoComplete="current-password"
                            disabled={submitting === "password"}
                          />
                          <button
                            type="button"
                            className="password-visibility-btn"
                            aria-label={currentPasswordVisible ? "Hide password" : "Show password"}
                            aria-pressed={currentPasswordVisible}
                            onClick={() => setCurrentPasswordVisible((current) => !current)}
                            disabled={submitting === "password"}
                          >
                            <PasswordVisibilityIcon />
                          </button>
                        </div>
                      </label>
                      <label className="form-label">New password
                        <div className="password-input-wrap">
                          <input
                            className="form-input password-input-field"
                            type={newPasswordVisible ? "text" : "password"}
                            value={newPassword}
                            onChange={(event) => setNewPassword(event.target.value)}
                            autoComplete="new-password"
                            disabled={submitting === "password"}
                          />
                          <button
                            type="button"
                            className="password-visibility-btn"
                            aria-label={newPasswordVisible ? "Hide password" : "Show password"}
                            aria-pressed={newPasswordVisible}
                            onClick={() => setNewPasswordVisible((current) => !current)}
                            disabled={submitting === "password"}
                          >
                            <PasswordVisibilityIcon />
                          </button>
                        </div>
                        <p className="password-requirement-note">Minimum 8 characters.</p>
                      </label>
                      <label className="form-label">Confirm new password
                        <div className="password-input-wrap">
                          <input
                            className="form-input password-input-field"
                            type={confirmPasswordVisible ? "text" : "password"}
                            value={confirmPassword}
                            onChange={(event) => setConfirmPassword(event.target.value)}
                            autoComplete="new-password"
                            disabled={submitting === "password"}
                          />
                          <button
                            type="button"
                            className="password-visibility-btn"
                            aria-label={confirmPasswordVisible ? "Hide password" : "Show password"}
                            aria-pressed={confirmPasswordVisible}
                            onClick={() => setConfirmPasswordVisible((current) => !current)}
                            disabled={submitting === "password"}
                          >
                            <PasswordVisibilityIcon />
                          </button>
                        </div>
                      </label>
                      {confirmPassword && newPassword !== confirmPassword ? (
                        <p className="settings-warning settings-warning--danger" style={{ margin: 0 }}>
                          The password entries do not match.
                        </p>
                      ) : null}
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <div className="form-actions" style={{ margin: 0 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    resetPasswordForm();
                    setActiveModal(null);
                  }}
                  disabled={submitting === "password"}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn--primary" disabled={submitting === "password"}>
                  {submitting === "password" ? "Changing..." : "Change password"}
                </button>
              </div>
            </div>
          </form>
        </SettingsModal>
      ) : null}

      {activeModal === "appearance" ? (
        <SettingsModal title="Appearance" onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default"><h3>Interface</h3></div>
                  <div className="app-settings-modal-section-body">
                    <ActiveThemePreviewRow theme={theme} onEdit={() => setShowThemeManager(true)} />
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
                        <div className="settings-row-label">Source and coding text</div>
                        <div className="settings-row-desc">Set the default text size for source reading and text coding.</div>
                      </div>
                      <TextSizeControls
                        fontSizePx={sourceTextSizePx}
                        onDecrease={() => handleSourceTextSize(sourceTextSizePx - SOURCE_TEXT_SIZE_STEP_PX)}
                        onIncrease={() => handleSourceTextSize(sourceTextSizePx + SOURCE_TEXT_SIZE_STEP_PX)}
                      />
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
