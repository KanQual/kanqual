import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import localDeviceIcon from "../assets/computer-line.svg";
import networkDeviceIcon from "../assets/network--2.svg";
import startupLogo from "../assets/logo-outline.png";
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
  const { login, register, error, status, serverUrl, setServerUrl, pb } = useAuth();
  const [panel, setPanel] = useState<Panel>("mode");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tempUrl, setTempUrl] = useState(serverUrl);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localUserCount, setLocalUserCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getRegisteredUserCount()
      .then((count) => {
        if (!cancelled) {
          setLocalUserCount(count);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLocalUserCount(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isFirstLocalUser = localUserCount === 0;
  const isLocal = serverUrl === LOCAL_PB_URL;
  const showRegisterOnly = isLocal && isFirstLocalUser;
  const authMode: "login" | "register" = showRegisterOnly ? "register" : panel === "register" ? "register" : "login";

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
    setServerUrl(tempUrl.trim());
    setPanel("login");
  }

  if (status === "loading") {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <img src={startupLogo} alt="Kanqual" className="auth-logo" />
          <div className="auth-brand">Kanqual</div>
          <p className="auth-starting">Starting up...</p>
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
          </div>
          <div className="mode-options">
            <button
              className="mode-option"
              onClick={async () => {
                const count = localUserCount ?? await getRegisteredUserCount().catch(() => null);
                if (count === 0) {
                  setEmail("");
                  setPassword("");
                  setName("");
                  setPanel("register");
                  return;
                }
                const accounts = getLocalAccounts();
                setPanel(accounts.length > 0 ? "local-accounts" : "login");
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
                const sessions = getRemoteSessions();
                if (sessions.length > 0) {
                  setPanel("remote-sessions");
                } else {
                  setTempUrl(serverUrl);
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
        </div>
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
            <button className="btn btn--sm" onClick={() => setPanel("mode")}>
              &larr; Back
            </button>
          </div>
        </div>
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
          <h2 className="auth-panel-title">Recent connections</h2>
          <ul className="account-list">
            {sessions.map((session) => (
              <li
                key={`${session.serverUrl}:${session.email}`}
                className="account-item"
                onClick={() => {
                  setServerUrl(session.serverUrl);
                  setEmail(session.email);
                  setPassword("");
                  setPanel("login");
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
                setTempUrl(serverUrl);
                setPanel("server");
              }}
            >
              + Connect to a new server
            </button>
            <button className="btn btn--sm" onClick={() => setPanel("mode")}>
              &larr; Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (panel === "server") {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <img src="/logo.png" alt="Kanqual" className="auth-logo" />
          <div className="auth-brand">Kanqual</div>
          <p className="auth-tagline">Text annotation for qualitative research</p>
          <form onSubmit={handleServerSave} className="form">
            <h2 className="auth-panel-title">Join a project on another device</h2>
            <p className="auth-hint">
              Ask the project host for their IP address and port, then sign in
              with your account on their server.
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
                  setPanel(sessions.length > 0 ? "remote-sessions" : "mode");
                }}
              >
                Back
              </button>
              <button type="submit" className="btn btn--primary">Connect</button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">Kanqual</div>
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
                setPanel(accounts.length > 0 ? "local-accounts" : "mode");
              } else {
                const sessions = getRemoteSessions();
                setPanel(sessions.length > 0 ? "remote-sessions" : "server");
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
    </div>
  );
}
