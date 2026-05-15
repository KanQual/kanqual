import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import localDeviceIcon from "../assets/computer-line.svg";
import networkDeviceIcon from "../assets/network--2.svg";
import startupLogo from "../assets/logo-outline.png";
import helpIcon from "../assets/ic_help_outline_24px.svg";
import {
  getLocalAccounts,
  getRemoteSessions,
  LOCAL_PB_URL,
  saveLocalAccount,
  saveRemoteSession,
} from "../lib/authHistory";
import { getRegisteredUserCount } from "../lib/pb";

type Panel = "mode" | "local-accounts" | "remote-sessions" | "login" | "register" | "server";

function fmtLastLogin(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (days === 0) return `Today at ${time}`;
  if (days === 1) return `Yesterday at ${time}`;
  const shortDate = date.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${shortDate} at ${time}`;
}

function initials(name: string): string {
  return (name || "?")
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function AuthView() {
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
        <h2>Sign In Help</h2>
        <div className="app-settings-modal-body">
          <p className="settings-section-desc">
            KanQual starts by asking whether you want to work locally on this device or connect to a project hosted by someone else.
          </p>
          <ul className="settings-help-list">
            <li>Work on your own device to start a local KanQual workspace on this machine.</li>
            <li>Join a project on another device to connect to a host's shared KanQual server on your network.</li>
            <li>Recent local accounts and remote connections are remembered on this device to make future sign-in faster.</li>
            <li>The first local account created on a device becomes that device's KanQual administrator.</li>
            <li>Returning to the mode chooser closes the current local workspace before switching modes.</li>
          </ul>
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => setHelpOpen(false)}>
              Close
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
      setLocalError(submitError instanceof Error ? submitError.message : "Something went wrong");
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
        setLocalError(serverError instanceof Error ? serverError.message : "Could not connect to that server.");
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
        setServerNotice(`Reached ${normalizedUrl}. You can try connecting now.`);
      })
      .catch((serverError) => {
        setLocalError(serverError instanceof Error ? serverError.message : "Could not reach that server.");
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
      setLocalError(modeError instanceof Error ? modeError.message : "Could not close the current workspace.");
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="auth-screen">
        <div className="auth-card auth-card--startup">
          <img src={startupLogo} alt="Kanqual" className="auth-logo" />
          <div className="auth-brand">Kanqual</div>
          <p className="auth-starting">Starting up...</p>
          {helpModal}
        </div>
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
            <button type="button" className="users-help-icon-btn" onClick={() => setHelpOpen(true)} aria-label="Open sign-in help">
              <img src={helpIcon} alt="" className="users-help-icon" />
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
                  setLocalError(modeError instanceof Error ? modeError.message : "Could not start local workspace.");
                }
              }}
            >
              <img src={localDeviceIcon} alt="" className="mode-option-icon" aria-hidden="true" />
              <span className="mode-option-title">Work on my own device</span>
              <span className="mode-option-desc">
                Store and analyse your data locally - nothing leaves this computer.
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
              <img src={networkDeviceIcon} alt="" className="mode-option-icon" aria-hidden="true" />
              <span className="mode-option-title">Join a project on another device</span>
              <span className="mode-option-desc">
                Connect to a project hosted by someone else on your network.
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
            <button type="button" className="users-help-icon-btn" onClick={() => setHelpOpen(true)} aria-label="Open sign-in help">
              <img src={helpIcon} alt="" className="users-help-icon" />
            </button>
          </div>
          <h2 className="auth-panel-title">Choose an account</h2>
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
                <div className="account-avatar">{initials(account.name)}</div>
                <div className="account-info">
                  <div className="account-name">{account.name}</div>
                  <div className="account-email">{account.email}</div>
                </div>
                <div className="account-login-time">{fmtLastLogin(account.lastLogin)}</div>
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
              + Use a different account
            </button>
            <button className="btn btn--sm" onClick={() => void handleReturnToMode()} disabled={submitting}>
              &larr; Back
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
            <button type="button" className="users-help-icon-btn" onClick={() => setHelpOpen(true)} aria-label="Open sign-in help">
              <img src={helpIcon} alt="" className="users-help-icon" />
            </button>
          </div>
          <h2 className="auth-panel-title">Recent connections</h2>
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
                        ? `${sessionError.message} Review or test the saved address below.`
                        : "Could not reach that saved server. Review or test the saved address below.",
                    );
                    setPanel("server");
                  }
                }}
              >
                <div className="account-avatar">{initials(session.name)}</div>
                <div className="account-info">
                  <div className="account-name">{session.name}</div>
                  <div className="account-email">{session.email}</div>
                  <div className="account-server">{session.serverUrl}</div>
                </div>
                <div className="account-login-time">{fmtLastLogin(session.lastLogin)}</div>
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
              + Connect to a new server
            </button>
            <button className="btn btn--sm" onClick={() => void handleReturnToMode()} disabled={submitting}>
              &larr; Back
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
            <button type="button" className="users-help-icon-btn" onClick={() => setHelpOpen(true)} aria-label="Open sign-in help">
              <img src={helpIcon} alt="" className="users-help-icon" />
            </button>
          </div>
          <p className="auth-tagline">Text annotation for qualitative research</p>
          <form onSubmit={handleServerSave} className="form">
            <h2 className="auth-panel-title">Join a project on another device</h2>
            <p className="auth-hint">
              Ask the project host for their IP address and port, then sign in
              with your account on their server.
            </p>
            <p className="auth-hint">
              If this fails, ask the host to open Kanqual and switch to network sharing mode.
            </p>
            <label className="form-label">
              Host IP address
              <input
                className="form-input"
                value={tempUrl}
                onChange={(e) => setTempUrl(e.target.value)}
                placeholder="e.g. 192.168.1.5:8090"
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
                Back
              </button>
              <button type="button" className="btn" onClick={handleServerTest} disabled={testingConnection || submitting}>
                {testingConnection ? "Testing..." : "Test Connection"}
              </button>
              <button type="submit" className="btn btn--primary">Connect</button>
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
          <button type="button" className="users-help-icon-btn" onClick={() => setHelpOpen(true)} aria-label="Open sign-in help">
            <img src={helpIcon} alt="" className="users-help-icon" />
          </button>
        </div>
        <p className="auth-tagline">Text annotation for qualitative research</p>

        <form onSubmit={handleSubmit} className="form">
          {!showRegisterOnly && (
            <div className="auth-tabs">
              <button
                type="button"
                className={`auth-tab ${panel === "login" ? "auth-tab--active" : ""}`}
                onClick={() => setPanel("login")}
              >
                Sign in
              </button>
              <button
                type="button"
                className={`auth-tab ${panel === "register" ? "auth-tab--active" : ""}`}
                onClick={() => setPanel("register")}
              >
                Create account
              </button>
            </div>
          )}

          {showRegisterOnly && (
            <div className="auth-admin-notice">
              <strong>This account will be the administrator on this device.</strong>
              <span>
                It will have access to all local KanQual information, including project and user administration, editing, deletion, and app-data clearing tools.
              </span>
            </div>
          )}

          {(panel === "register" || showRegisterOnly) && (
            <label className="form-label">
              Name
              <input
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                required
                autoFocus
              />
            </label>
          )}

          <label className="form-label">
            Email
            <input
              className="form-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>

          <label className="form-label">
            Password
            <input
              className="form-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="........"
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
                ? "Sign in"
                : "Create account"}
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
            &larr; Back
          </button>

          <p className="auth-server-info">
            {isLocal ? "Working with local data" : `Connected to ${serverUrl}`}
          </p>
        </form>
      </div>
      {helpModal}
    </div>
  );
}
