import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/provider";
import { ComputerIcon, HelpIcon, NetworkIcon } from "../components/AppIcons";
import { LoadingCard } from "../components/LoadingCard";
import {
  getLocalAccounts,
  getRemoteSessions,
  LOCAL_PB_URL,
  saveLocalAccount,
  saveRemoteSession,
} from "../lib/authHistory";
import { getRegisteredUserCount } from "../lib/pb";
import { formatCurrentDate, formatCurrentDateTime } from "../i18n/formatters";

type Panel = "mode" | "local-accounts" | "remote-sessions" | "login" | "register" | "server";

function fmtLastLogin(iso: string, t: ReturnType<typeof useI18n>["t"]): string {
  const date = new Date(iso);
  const now = new Date();
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  const time = formatCurrentDateTime(date, { hour: "2-digit", minute: "2-digit" });
  if (days === 0) return t("auth.relativeTime.todayAt", { time });
  if (days === 1) return t("auth.relativeTime.yesterdayAt", { time });
  const shortDate = formatCurrentDate(date, { month: "short", day: "numeric" });
  return t("auth.relativeTime.shortDateAt", { date: shortDate, time });
}

function initials(name: string, locale: string): string {
  return (name || "?")
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toLocaleUpperCase(locale);
}

export function AuthView() {
  const { locale, t } = useI18n();
  const { login, register, error, status, serverUrl, useLocalServer, useRemoteServer, testRemoteServer, returnToModeSelection, pb } = useAuth();
  const [panel, setPanel] = useState<Panel>("mode");
  const [helpOpen, setHelpOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tempUrl, setTempUrl] = useState(serverUrl);
  const [submitting, setSubmitting] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [serverNotice, setServerNotice] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localUserCount, setLocalUserCount] = useState<number | null>(null);

  const isFirstLocalUser = localUserCount === 0;
  const isLocal = serverUrl === LOCAL_PB_URL;
  const showRegisterOnly = isLocal && isFirstLocalUser;
  const authMode: "login" | "register" = showRegisterOnly ? "register" : panel === "register" ? "register" : "login";

  const helpModal = helpOpen ? (
      <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
      <div className="modal modal--help" onClick={(e) => e.stopPropagation()}>
        <h2>{t("auth.help.title")}</h2>
        <div className="app-settings-modal-body">
          <p className="settings-section-desc">
            {t("auth.help.intro")}
          </p>
          <ul className="settings-help-list">
            <li>{t("auth.help.localDevice")}</li>
            <li>{t("auth.help.remoteProject")}</li>
            <li>{t("auth.help.rememberedSessions")}</li>
            <li>{t("auth.help.firstAdmin")}</li>
            <li>{t("auth.help.modeChooser")}</li>
          </ul>
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => setHelpOpen(false)}>
              {t("common.close")}
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setSubmitting(true);
    try {
      if (authMode === "login") {
        await login(email, password);
        const displayName = String(pb?.authStore.record?.name ?? email.split("@")[0]);
        if (isLocal) saveLocalAccount(email, displayName);
        else saveRemoteSession(serverUrl, email, displayName);
      } else {
        await register(name, email, password);
        saveLocalAccount(email, name);
      }
    } catch (submitError) {
      setLocalError(submitError instanceof Error ? submitError.message : t("auth.form.unknownError"));
    } finally {
      setSubmitting(false);
    }
  }

  function handleServerSave(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setServerNotice(null);
    setSubmitting(true);
    void useRemoteServer(tempUrl.trim())
      .then(() => {
        setPanel("login");
      })
      .catch((serverError) => {
        setLocalError(serverError instanceof Error ? serverError.message : t("auth.server.connectError"));
      })
      .finally(() => {
        setSubmitting(false);
      });
  }

  function handleServerTest() {
    setLocalError(null);
    setServerNotice(null);
    setTestingConnection(true);
    void testRemoteServer(tempUrl.trim())
      .then((normalizedUrl) => {
        setServerNotice(t("auth.server.reachedServer", { url: normalizedUrl }));
      })
      .catch((serverError) => {
        setLocalError(serverError instanceof Error ? serverError.message : t("auth.server.reachError"));
      })
      .finally(() => {
        setTestingConnection(false);
      });
  }

  async function handleReturnToMode() {
    setLocalError(null);
    setSubmitting(true);
    try {
      await returnToModeSelection();
      setPanel("mode");
      setTempUrl("");
      setEmail("");
      setPassword("");
    } catch (modeError) {
      setLocalError(modeError instanceof Error ? modeError.message : t("auth.server.closeWorkspaceError"));
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="auth-screen">
        <LoadingCard />
        {helpModal}
      </div>
    );
  }

  if (panel === "mode") {
    return (
      <div className="auth-screen">
        <div className="auth-card auth-card--mode">
          <div className="auth-mode-header">
            <img src="/logo.png" alt="KanQual" className="auth-logo auth-logo--mode" />
            <div className="auth-brand auth-brand--mode">KanQual</div>
            <button type="button" className="users-help-icon-btn" onClick={() => setHelpOpen(true)} aria-label={t("auth.mode.openHelp")}>
              <HelpIcon className="users-help-icon" />
            </button>
          </div>
          <div className="mode-options">
            <button
              className="mode-option"
              onClick={async () => {
                try {
                  setLocalError(null);
                  setServerNotice(null);
                  await useLocalServer();
                  const count = await getRegisteredUserCount().catch(() => null);
                  setLocalUserCount(count);
                  if (count === 0) {
                    setEmail("");
                    setPassword("");
                    setName("");
                    setPanel("register");
                    return;
                  }
                  const accounts = getLocalAccounts();
                  setPanel(accounts.length > 0 ? "local-accounts" : "login");
                } catch (modeError) {
                  setLocalError(modeError instanceof Error ? modeError.message : t("auth.mode.localStartError"));
                }
              }}
            >
              <ComputerIcon className="mode-option-icon" />
              <span className="mode-option-title">{t("auth.mode.localTitle")}</span>
              <span className="mode-option-desc">
                {t("auth.mode.localDescription")}
              </span>
            </button>
            <button
              className="mode-option"
              onClick={() => {
                setLocalError(null);
                setServerNotice(null);
                const sessions = getRemoteSessions();
                if (sessions.length > 0) {
                  setPanel("remote-sessions");
                } else {
                  setTempUrl(serverUrl === LOCAL_PB_URL ? "" : serverUrl);
                  setPanel("server");
                }
              }}
            >
              <NetworkIcon className="mode-option-icon" />
              <span className="mode-option-title">{t("auth.mode.remoteTitle")}</span>
              <span className="mode-option-desc">
                {t("auth.mode.remoteDescription")}
              </span>
            </button>
          </div>
          {localError && <p className="auth-error">{localError}</p>}
        </div>
        {helpModal}
      </div>
    );
  }

  if (panel === "local-accounts") {
    const accounts = getLocalAccounts();
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <img src="/logo.png" alt="Kanqual" className="auth-logo" />
          <div className="auth-brand">Kanqual</div>
          <div className="auth-help-row">
            <button type="button" className="users-help-icon-btn" onClick={() => setHelpOpen(true)} aria-label={t("auth.mode.openHelp")}>
              <HelpIcon className="users-help-icon" />
            </button>
          </div>
          <h2 className="auth-panel-title">{t("auth.localAccounts.title")}</h2>
          <ul className="account-list">
            {accounts.map((account) => (
              <li
                key={account.email}
                className="account-item"
                onClick={() => {
                  setEmail(account.email);
                  setPassword("");
                  setPanel("login");
                }}
              >
                <div className="account-avatar">{initials(account.name, locale)}</div>
                <div className="account-info">
                  <div className="account-name">{account.name}</div>
                  <div className="account-email">{account.email}</div>
                </div>
                <div className="account-login-time">{fmtLastLogin(account.lastLogin, t)}</div>
              </li>
            ))}
          </ul>
          <div className="account-list-actions">
            <button
              className="btn btn--sm"
              onClick={() => {
                setEmail("");
                setPassword("");
                setPanel("login");
              }}
            >
              {t("auth.localAccounts.useDifferent")}
            </button>
            <button className="btn btn--sm" onClick={() => void handleReturnToMode()} disabled={submitting}>
              &larr; {t("auth.localAccounts.back")}
            </button>
          </div>
        </div>
        {helpModal}
      </div>
    );
  }

  if (panel === "remote-sessions") {
    const sessions = getRemoteSessions();
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <img src="/logo.png" alt="Kanqual" className="auth-logo" />
          <div className="auth-brand">Kanqual</div>
          <div className="auth-help-row">
            <button type="button" className="users-help-icon-btn" onClick={() => setHelpOpen(true)} aria-label={t("auth.mode.openHelp")}>
              <HelpIcon className="users-help-icon" />
            </button>
          </div>
          <h2 className="auth-panel-title">{t("auth.remoteSessions.title")}</h2>
          <ul className="account-list">
            {sessions.map((session) => (
              <li
                key={`${session.serverUrl}:${session.email}`}
                className="account-item"
                onClick={async () => {
                  try {
                    setLocalError(null);
                    setServerNotice(null);
                    await useRemoteServer(session.serverUrl);
                    setEmail(session.email);
                    setPassword("");
                    setPanel("login");
                  } catch (sessionError) {
                    setTempUrl(session.serverUrl);
                    setEmail(session.email);
                    setPassword("");
                    setLocalError(
                      sessionError instanceof Error
                        ? t("auth.remoteSessions.savedServerError", { message: sessionError.message })
                        : t("auth.remoteSessions.savedServerFallback"),
                    );
                    setPanel("server");
                  }
                }}
              >
                <div className="account-avatar">{initials(session.name, locale)}</div>
                <div className="account-info">
                  <div className="account-name">{session.name}</div>
                  <div className="account-email">{session.email}</div>
                  <div className="account-server">{session.serverUrl}</div>
                </div>
                <div className="account-login-time">{fmtLastLogin(session.lastLogin, t)}</div>
              </li>
            ))}
          </ul>
          <div className="account-list-actions">
            <button
              className="btn btn--sm"
              onClick={() => {
                setTempUrl(serverUrl === LOCAL_PB_URL ? "" : serverUrl);
                setPanel("server");
              }}
            >
              {t("auth.remoteSessions.connectNew")}
            </button>
            <button className="btn btn--sm" onClick={() => void handleReturnToMode()} disabled={submitting}>
              &larr; {t("auth.remoteSessions.back")}
            </button>
          </div>
        </div>
        {helpModal}
      </div>
    );
  }

  if (panel === "server") {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <img src="/logo.png" alt="Kanqual" className="auth-logo" />
          <div className="auth-brand">Kanqual</div>
          <div className="auth-help-row">
            <button type="button" className="users-help-icon-btn" onClick={() => setHelpOpen(true)} aria-label={t("auth.mode.openHelp")}>
              <HelpIcon className="users-help-icon" />
            </button>
          </div>
          <p className="auth-tagline">{t("auth.server.tagline")}</p>
          <form onSubmit={handleServerSave} className="form">
            <h2 className="auth-panel-title">{t("auth.server.title")}</h2>
            <p className="auth-hint">
              {t("auth.server.hostHint")}
            </p>
            <p className="auth-hint">
              {t("auth.server.modeHint")}
            </p>
            <label className="form-label">
              {t("auth.server.hostLabel")}
              <input
                className="form-input"
                value={tempUrl}
                onChange={(e) => setTempUrl(e.target.value)}
                placeholder={t("auth.server.hostPlaceholder")}
                autoFocus
              />
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const sessions = getRemoteSessions();
                  if (sessions.length > 0) {
                    setPanel("remote-sessions");
                  } else {
                    void handleReturnToMode();
                }
              }}
            >
                {t("auth.server.back")}
              </button>
              <button type="button" className="btn" onClick={handleServerTest} disabled={testingConnection || submitting}>
                {testingConnection ? t("auth.server.testing") : t("auth.server.testConnection")}
              </button>
              <button type="submit" className="btn btn--primary">{t("auth.server.connect")}</button>
            </div>
            {serverNotice && <p className="settings-success">{serverNotice}</p>}
            {localError && <p className="auth-error">{localError}</p>}
          </form>
        </div>
        {helpModal}
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">Kanqual</div>
        <div className="auth-help-row">
          <button type="button" className="users-help-icon-btn" onClick={() => setHelpOpen(true)} aria-label={t("auth.mode.openHelp")}>
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
        <p className="auth-tagline">{t("auth.form.tagline")}</p>

        <form onSubmit={handleSubmit} className="form">
          {!showRegisterOnly && (
            <div className="segmented-control">
              <button
                type="button"
                className={`segmented-control-option ${panel === "login" ? "segmented-control-option--active" : ""}`}
                onClick={() => setPanel("login")}
              >
                {t("auth.form.signIn")}
              </button>
              <button
                type="button"
                className={`segmented-control-option ${panel === "register" ? "segmented-control-option--active" : ""}`}
                onClick={() => setPanel("register")}
              >
                {t("auth.form.createAccount")}
              </button>
            </div>
          )}

          {showRegisterOnly && (
            <div className="auth-admin-notice">
              <strong>{t("auth.form.firstAdminTitle")}</strong>
              <span>
                {t("auth.form.firstAdminBody")}
              </span>
            </div>
          )}

          {(panel === "register" || showRegisterOnly) && (
            <label className="form-label">
              {t("auth.form.name")}
              <input
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("auth.form.namePlaceholder")}
                required
                autoFocus
              />
            </label>
          )}

          <label className="form-label">
            {t("auth.form.email")}
            <input
              className="form-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("auth.form.emailPlaceholder")}
              required
            />
          </label>

          <label className="form-label">
            {t("auth.form.password")}
            <input
              className="form-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("auth.form.passwordPlaceholder")}
              required
              minLength={8}
              autoFocus={!!email}
            />
          </label>

          {(localError ?? error) && (
            <p className="auth-error">{localError ?? error}</p>
          )}

          <button type="submit" className="btn btn--primary" disabled={submitting}>
            {submitting
              ? "Please wait..."
              : authMode === "login"
                ? t("auth.form.signIn")
                : t("auth.form.createAccount")}
          </button>

          <button
            type="button"
            className="auth-server-link"
            onClick={() => {
              if (isLocal) {
                const accounts = getLocalAccounts();
                if (accounts.length > 0) {
                  setPanel("local-accounts");
                } else {
                  void handleReturnToMode();
                }
              } else {
                const sessions = getRemoteSessions();
                if (sessions.length > 0) {
                  setPanel("remote-sessions");
                } else {
                  void handleReturnToMode();
                }
              }
            }}
          >
            &larr; {t("auth.form.back")}
          </button>

          <p className="auth-server-info">
            {isLocal ? t("auth.form.localData") : t("auth.form.connectedTo", { serverUrl })}
          </p>
        </form>
      </div>
      {helpModal}
    </div>
  );
}
