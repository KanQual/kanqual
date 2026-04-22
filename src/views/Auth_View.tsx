import { useState } from "react";
import { useAuth } from "../context/AuthContext";

type Panel = "mode" | "local-accounts" | "remote-sessions" | "login" | "register" | "server";

// ─── History stored in localStorage ─────────────────────────────────────────

interface AccountHistory {
  email: string;
  name: string;
  lastLogin: string; // ISO 8601
}

interface RemoteSession {
  serverUrl: string;
  email: string;
  name: string;
  lastLogin: string; // ISO 8601
}

const LOCAL_ACCOUNTS_KEY  = "mc_local_accounts";
const REMOTE_SESSIONS_KEY = "mc_remote_sessions";
const LOCAL_PB_URL        = "http://127.0.0.1:8090";

function getLocalAccounts(): AccountHistory[] {
  try { return JSON.parse(localStorage.getItem(LOCAL_ACCOUNTS_KEY) ?? "[]"); }
  catch { return []; }
}

function saveLocalAccount(email: string, name: string): void {
  const list = getLocalAccounts().filter((a) => a.email !== email);
  list.unshift({ email, name, lastLogin: new Date().toISOString() });
  localStorage.setItem(LOCAL_ACCOUNTS_KEY, JSON.stringify(list.slice(0, 20)));
}

function getRemoteSessions(): RemoteSession[] {
  try { return JSON.parse(localStorage.getItem(REMOTE_SESSIONS_KEY) ?? "[]"); }
  catch { return []; }
}

function saveRemoteSession(serverUrl: string, email: string, name: string): void {
  const list = getRemoteSessions().filter(
    (s) => !(s.serverUrl === serverUrl && s.email === email)
  );
  list.unshift({ serverUrl, email, name, lastLogin: new Date().toISOString() });
  localStorage.setItem(REMOTE_SESSIONS_KEY, JSON.stringify(list.slice(0, 20)));
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function fmtLastLogin(iso: string): string {
  const d    = new Date(iso);
  const now  = new Date();
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (days === 0) return `Today at ${time}`;
  if (days === 1) return `Yesterday at ${time}`;
  const date = d.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${date} at ${time}`;
}

function initials(name: string): string {
  return (name || "?")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AuthView() {
  const { login, register, error, status, serverUrl, setServerUrl, pb } = useAuth();
  const [panel,      setPanel]      = useState<Panel>("mode");
  const [name,       setName]       = useState("");
  const [email,      setEmail]      = useState("");
  const [password,   setPassword]   = useState("");
  const [tempUrl,    setTempUrl]    = useState(serverUrl);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // ── Login / Register submit ──────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setSubmitting(true);
    try {
      const isLocal = serverUrl === LOCAL_PB_URL;
      if (panel === "login") {
        await login(email, password);
        const displayName = String(pb?.authStore.record?.name ?? email.split("@")[0]);
        if (isLocal) saveLocalAccount(email, displayName);
        else         saveRemoteSession(serverUrl, email, displayName);
      } else {
        await register(name, email, password);
        saveLocalAccount(email, name);
      }
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Server URL submit ────────────────────────────────────────────────────────

  function handleServerSave(e: React.FormEvent) {
    e.preventDefault();
    setServerUrl(tempUrl.trim());
    setPanel("login");
  }

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (status === "loading") {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <img src="/logo.png" alt="Kanqual" className="auth-logo" />
          <div className="auth-brand">Kanqual</div>
          <p className="auth-starting">Starting up…</p>
        </div>
      </div>
    );
  }

  // ── Mode selection ───────────────────────────────────────────────────────────

  if (panel === "mode") {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <img src="/logo.png" alt="Kanqual" className="auth-logo" />
          <div className="auth-brand">Kanqual</div>
          <p className="auth-tagline">Text annotation for qualitative research</p>
          <div className="mode-options">
            <button
              className="mode-option"
              onClick={() => {
                const accounts = getLocalAccounts();
                setPanel(accounts.length > 0 ? "local-accounts" : "login");
              }}
            >
              <span className="mode-option-title">Work on my own device</span>
              <span className="mode-option-desc">
                Store and analyse your data locally — nothing leaves this computer.
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

  // ── Local accounts list ──────────────────────────────────────────────────────

  if (panel === "local-accounts") {
    const accounts = getLocalAccounts();
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <img src="/logo.png" alt="Kanqual" className="auth-logo" />
          <div className="auth-brand">Kanqual</div>
          <h2 className="auth-panel-title">Choose an account</h2>
          <ul className="account-list">
            {accounts.map((a) => (
              <li
                key={a.email}
                className="account-item"
                onClick={() => {
                  setEmail(a.email);
                  setPassword("");
                  setPanel("login");
                }}
              >
                <div className="account-avatar">{initials(a.name)}</div>
                <div className="account-info">
                  <div className="account-name">{a.name}</div>
                  <div className="account-email">{a.email}</div>
                </div>
                <div className="account-login-time">{fmtLastLogin(a.lastLogin)}</div>
              </li>
            ))}
          </ul>
          <div className="account-list-actions">
            <button
              className="btn btn--sm"
              onClick={() => { setEmail(""); setPassword(""); setPanel("login"); }}
            >
              + Use a different account
            </button>
            <button className="btn btn--sm" onClick={() => setPanel("mode")}>
              ← Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Remote sessions list ─────────────────────────────────────────────────────

  if (panel === "remote-sessions") {
    const sessions = getRemoteSessions();
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <img src="/logo.png" alt="Kanqual" className="auth-logo" />
          <div className="auth-brand">Kanqual</div>
          <h2 className="auth-panel-title">Recent connections</h2>
          <ul className="account-list">
            {sessions.map((s) => (
              <li
                key={`${s.serverUrl}:${s.email}`}
                className="account-item"
                onClick={() => {
                  setServerUrl(s.serverUrl);
                  setEmail(s.email);
                  setPassword("");
                  setPanel("login");
                }}
              >
                <div className="account-avatar">{initials(s.name)}</div>
                <div className="account-info">
                  <div className="account-name">{s.name}</div>
                  <div className="account-email">{s.email}</div>
                  <div className="account-server">{s.serverUrl}</div>
                </div>
                <div className="account-login-time">{fmtLastLogin(s.lastLogin)}</div>
              </li>
            ))}
          </ul>
          <div className="account-list-actions">
            <button
              className="btn btn--sm"
              onClick={() => { setTempUrl(serverUrl); setPanel("server"); }}
            >
              + Connect to a new server
            </button>
            <button className="btn btn--sm" onClick={() => setPanel("mode")}>
              ← Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Server URL entry ─────────────────────────────────────────────────────────

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

  // ── Login / Register ─────────────────────────────────────────────────────────

  const isLocal = serverUrl === LOCAL_PB_URL;

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">Kanqual</div>
        <p className="auth-tagline">Text annotation for qualitative research</p>

        <form onSubmit={handleSubmit} className="form">
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

          {panel === "register" && (
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
              placeholder="••••••••"
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
              ? "Please wait…"
              : panel === "login"
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
            ← Back
          </button>

          <p className="auth-server-info">
            {isLocal ? "Working with local data" : `Connected to ${serverUrl}`}
          </p>
        </form>
      </div>
    </div>
  );
}
