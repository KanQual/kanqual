import { useEffect, useState, type FormEvent } from "react";
import {
  completePostgresAdminHandoff,
  listPostgresExperimentRememberedAccounts,
  loginPostgresExperimentAdmin,
  loginPostgresExperimentAppUser,
  rememberPostgresExperimentAccount,
  registerPostgresExperimentAppUser,
  type PostgresExperimentAuthSession,
  type PostgresExperimentAuthStatus,
  type PostgresExperimentRememberedAccount,
  type PostgresExperimentStatus,
} from "../lib/postgresExperiment";
import { formatCurrentDateTime } from "../i18n/formatters";

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function formatRecentLogin(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  const time = formatCurrentDateTime(date, { hour: "2-digit", minute: "2-digit" });
  if (days === 0) return `Today at ${time}`;
  if (days === 1) return `Yesterday at ${time}`;
  const shortDate = date.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${shortDate} at ${time}`;
}

function accountInitials(name: string): string {
  return (name || "?")
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export type PostgresAdminHandoffViewProps = {
  status: PostgresExperimentStatus;
  onComplete: (nextStatus: PostgresExperimentStatus) => void | Promise<void>;
};

export function PostgresAdminHandoffView({
  status,
  onComplete,
}: PostgresAdminHandoffViewProps) {
  const [username, setUsername] = useState(status.superuserName);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!username.trim()) {
      setError("Enter the new PostgreSQL admin username.");
      return;
    }
    if (!password || !confirmPassword) {
      setError("Enter the new PostgreSQL admin password twice.");
      return;
    }
    if (password.length < 8) {
      setError("Choose a PostgreSQL admin password with at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The PostgreSQL admin passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      const nextStatus = await completePostgresAdminHandoff({
        newSuperuserName: username.trim(),
        newSuperuserPassword: password,
      });
      setUsername(nextStatus.superuserName);
      setPassword("");
      setConfirmPassword("");
      await onComplete(nextStatus);
    } catch (handoffError) {
      setError(handoffError instanceof Error ? handoffError.message : String(handoffError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card" style={{ maxWidth: 760 }}>
        <div className="auth-brand">Kanqual</div>
        <p className="auth-tagline">PostgreSQL Experiment</p>
        <form onSubmit={handleSubmit} className="form">
          <h2 className="auth-panel-title">Finish local database admin setup</h2>
          <p className="auth-hint">
            Kanqual has already bootstrapped the restricted app role{" "}
            <code>{status.appRoleName}</code>{" "}
            for the local database{" "}
            <code>{status.appDatabase}</code>
            .
          </p>
          <div className="settings-warning settings-warning--danger">
            Set the PostgreSQL administrator password now. Kanqual will not be able to recover it for you after this handoff completes.
          </div>
          <label className="form-label">
            New PostgreSQL admin username
            <input
              className="form-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
            />
          </label>
          <label className="form-label">
            New PostgreSQL admin password
            <input
              className="form-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="form-label">
            Confirm PostgreSQL admin password
            <input
              className="form-input"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          {error ? <p className="auth-error">{error}</p> : null}
          <div className="form-actions">
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? "Finalizing..." : "Finalize admin handoff"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export type PostgresExperimentLaunchViewProps = {
  status: PostgresExperimentStatus | null;
  loading: boolean;
  onRefresh: () => void;
  onBootstrap: (superuserPassword: string) => Promise<void>;
  onOpenPostgresProjects: () => void;
};

export function PostgresExperimentLaunchView({
  status,
  loading,
  onRefresh,
  onBootstrap,
  onOpenPostgresProjects,
}: PostgresExperimentLaunchViewProps) {
  const [superuserPassword, setSuperuserPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const bootstrapApplied = !!status?.bootstrapApplied;
  const adminHandoffCompleted = !!status?.adminHandoffCompleted;
  const appRoleReady = bootstrapApplied && adminHandoffCompleted;

  async function handleBootstrapSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!superuserPassword) {
      setError("Enter the current PostgreSQL superuser password to bootstrap the experiment.");
      return;
    }

    setSubmitting(true);
    try {
      await onBootstrap(superuserPassword);
      setSuperuserPassword("");
      setNotice("PostgreSQL bootstrap completed. You can continue the admin handoff on the next screen.");
    } catch (bootstrapError) {
      setError(bootstrapError instanceof Error ? bootstrapError.message : String(bootstrapError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card" style={{ maxWidth: 820 }}>
        <div className="auth-brand">Kanqual</div>
        <p className="auth-tagline">PostgreSQL Experiment</p>
        <div className="form">
          <h2 className="auth-panel-title">Local database experiment launch check</h2>
          <p className="auth-hint">
            PostgreSQL can now be bootstrapped and checked before the project workspace opens.
          </p>

          <div className="settings-warning">
            <strong>Current runtime state</strong>
            <br />
            {status
              ? (status.serviceReachable
                ? `PostgreSQL is reachable at ${status.host}:${status.port}.`
                : `PostgreSQL is not reachable at ${status.host}:${status.port}.`)
              : "Loading PostgreSQL experiment status..."}
            <br />
            {status
              ? `App role: ${status.appRoleName} on database ${status.appDatabase}.`
              : "Reading planned app role and database..."}
          </div>

          {!bootstrapApplied && (
            <form onSubmit={handleBootstrapSubmit} className="form">
              <div className="settings-warning settings-warning--danger">
                Bootstrap has not been applied yet. Enter the current PostgreSQL superuser password to create the restricted app role and experiment database.
              </div>
              <label className="form-label">
                Current PostgreSQL superuser password
                <input
                  className="form-input"
                  type="password"
                  value={superuserPassword}
                  onChange={(e) => setSuperuserPassword(e.target.value)}
                  autoFocus
                  autoComplete="current-password"
                />
              </label>
              <div className="form-actions">
                <button type="button" className="btn" onClick={onRefresh} disabled={loading || submitting}>
                  Refresh status
                </button>
                <button type="submit" className="btn btn--primary" disabled={loading || submitting}>
                  {submitting ? "Bootstrapping..." : "Bootstrap PostgreSQL experiment"}
                </button>
              </div>
            </form>
          )}

          {bootstrapApplied && !adminHandoffCompleted && (
            <>
              <div className="settings-warning settings-warning--danger">
                Bootstrap is complete, but the PostgreSQL admin password handoff still needs to be finalized before this experiment is considered ready.
              </div>
              <div className="form-actions">
                <button type="button" className="btn" onClick={onRefresh} disabled={loading}>
                  Refresh status
                </button>
              </div>
            </>
          )}

          {appRoleReady && (
            <>
              <div className="settings-warning">
                <strong>Experiment ready</strong>
                <br />
                The PostgreSQL bootstrap and admin handoff are complete. Continue into PostgreSQL projects to sign in and open a workspace.
              </div>
              <div className="form-actions">
                <button type="button" className="btn" onClick={onRefresh} disabled={loading}>
                  Refresh status
                </button>
                <button type="button" className="btn btn--primary" onClick={onOpenPostgresProjects}>
                  Open PostgreSQL projects
                </button>
              </div>
            </>
          )}

          {notice ? <p className="settings-success">{notice}</p> : null}
          {error ? <p className="auth-error">{error}</p> : null}

          {status ? (
            <p className="auth-hint settings-code-line">
              {status.bootstrapIdentityPath}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export type PostgresExperimentAuthViewProps = {
  authStatus: PostgresExperimentAuthStatus | null;
  onRefresh: () => Promise<void>;
  onAuthenticated: (session: PostgresExperimentAuthSession) => void;
};

export function PostgresExperimentAuthView({
  authStatus,
  onRefresh,
  onAuthenticated,
}: PostgresExperimentAuthViewProps) {
  const [mode, setMode] = useState<"admin" | "login" | "register">("admin");
  const [name, setName] = useState("");
  const [adminUsername, setAdminUsername] = useState("");
  const [email, setEmail] = useState("");
  const [recentAccounts, setRecentAccounts] = useState<PostgresExperimentRememberedAccount[]>([]);
  const [selectedRecentEmail, setSelectedRecentEmail] = useState("");
  const [showManualEmailEntry, setShowManualEmailEntry] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const effectiveMode = mode;
  const selectedRecentAccount = selectedRecentEmail
    ? recentAccounts.find((account) => account.email === selectedRecentEmail) ?? null
    : null;

  useEffect(() => {
    let cancelled = false;

    async function loadRecentAccounts() {
      try {
        const nextAccounts = await listPostgresExperimentRememberedAccounts();
        if (!cancelled) {
          setRecentAccounts(nextAccounts);
        }
      } catch (loadError) {
        if (!cancelled) {
          console.warn("Could not load remembered PostgreSQL accounts:", describeUnknownError(loadError));
        }
      }
    }

    void loadRecentAccounts();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (effectiveMode === "admin") {
      if (!adminUsername.trim()) {
        setError("Enter the PostgreSQL administrator username.");
        return;
      }
      if (password.length < 8) {
        setError("Enter the PostgreSQL administrator password.");
        return;
      }
      setSubmitting(true);
      try {
        const session = await loginPostgresExperimentAdmin({
          username: adminUsername.trim(),
          password,
          rememberSession: false,
        });
        setPassword("");
        onAuthenticated(session);
      } catch (authError) {
        setError(describeUnknownError(authError));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();
    if (effectiveMode === "register" && !name.trim()) {
      setError("Enter your name.");
      return;
    }
    if (!trimmedEmail) {
      setError("Enter your email.");
      return;
    }
    if (password.length < 8) {
      setError("Choose a password with at least 8 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const session = effectiveMode === "register"
        ? await registerPostgresExperimentAppUser({
            name: name.trim(),
            email: trimmedEmail,
            password,
            rememberSession: false,
          })
        : await loginPostgresExperimentAppUser({
            email: trimmedEmail,
            password,
            rememberSession: false,
          });
      await rememberPostgresExperimentAccount(trimmedEmail, session.user.name || name.trim() || trimmedEmail);
      setRecentAccounts(await listPostgresExperimentRememberedAccounts());
      setPassword("");
      onAuthenticated(session);
    } catch (authError) {
      setError(describeUnknownError(authError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card" style={{ maxWidth: 720 }}>
        <div className="auth-brand">Kanqual</div>
        <p className="auth-tagline">PostgreSQL Experiment</p>

        <form onSubmit={handleSubmit} className="form">
          <h2 className="auth-panel-title">Sign in to the PostgreSQL workspace</h2>
          <p className="auth-hint">
            PostgreSQL bootstrap is complete. The local PostgreSQL administrator is now the built-in Kanqual administrator for this device.
          </p>

          <div className="auth-tabs">
            <button
              type="button"
              className={`auth-tab ${effectiveMode === "admin" ? "auth-tab--active" : ""}`}
              onClick={() => setMode("admin")}
            >
              Local administrator
            </button>
            <button
              type="button"
              className={`auth-tab ${effectiveMode === "login" ? "auth-tab--active" : ""}`}
              onClick={() => {
                setMode("login");
                setError("");
                setShowManualEmailEntry(false);
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              className={`auth-tab ${effectiveMode === "register" ? "auth-tab--active" : ""}`}
              onClick={() => {
                setMode("register");
                setSelectedRecentEmail("");
                setShowManualEmailEntry(false);
                setError("");
              }}
            >
              Create account
            </button>
          </div>

          {effectiveMode === "admin" && (
            <div className="auth-admin-notice">
              <strong>Built-in local administrator</strong>
              <span>
                Sign in with the PostgreSQL superuser account to get full access across all local PostgreSQL projects.
              </span>
              <span>
                Local administrator sessions are only kept for the current app run and are not restored after restart.
              </span>
            </div>
          )}

          {effectiveMode === "register" && (
            <div className="auth-admin-notice">
              <strong>Regular PostgreSQL app account</strong>
              <span>
                Accounts created here are standard Kanqual users. They are separate from the built-in PostgreSQL administrator.
              </span>
            </div>
          )}

          {effectiveMode === "register" && (
            <label className="form-label">
              Name
              <input
                className="form-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your name"
                autoFocus
              />
            </label>
          )}

          {effectiveMode === "login" && recentAccounts.length > 0 && !selectedRecentAccount && !showManualEmailEntry ? (
            <div className="form-label">
              Recent accounts
              <ul className="account-list" style={{ marginTop: 10, marginBottom: 12 }}>
                {recentAccounts.map((account) => (
                  <li
                    key={account.email}
                    className="account-item"
                    onClick={() => {
                      setEmail(account.email);
                      setSelectedRecentEmail(account.email);
                      setShowManualEmailEntry(false);
                      setPassword("");
                      setError("");
                    }}
                  >
                    <div className="account-avatar">{accountInitials(account.name)}</div>
                    <div className="account-info">
                      <div className="account-name">{account.name}</div>
                      <div className="account-email">{account.email}</div>
                    </div>
                    <div className="account-login-time">{formatRecentLogin(account.lastLogin)}</div>
                  </li>
                ))}
              </ul>
              <div className="account-list-actions" style={{ justifyContent: "flex-start", marginBottom: 8 }}>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => {
                    setEmail("");
                    setSelectedRecentEmail("");
                    setShowManualEmailEntry(true);
                    setError("");
                  }}
                >
                  Use different email
                </button>
              </div>
            </div>
          ) : null}

          {effectiveMode === "login" && selectedRecentAccount ? (
            <div className="auth-admin-notice">
              <strong>{selectedRecentAccount.name}</strong>
              <span>{selectedRecentAccount.email}</span>
              <div className="form-actions" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => {
                    setEmail("");
                    setSelectedRecentEmail("");
                    setShowManualEmailEntry(true);
                    setPassword("");
                    setError("");
                  }}
                >
                  Use different email
                </button>
              </div>
            </div>
          ) : null}

          {(effectiveMode === "register" || (effectiveMode === "login" && (!selectedRecentAccount && (showManualEmailEntry || recentAccounts.length === 0)))) ? (
            <label className="form-label">
              Email
              <input
                className="form-input"
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setSelectedRecentEmail("");
                  setShowManualEmailEntry(true);
                }}
                placeholder="you@example.com"
                autoFocus={effectiveMode === "login"}
              />
            </label>
          ) : null}

          {effectiveMode === "admin" && (
            <label className="form-label">
              PostgreSQL administrator username
              <input
                className="form-input"
                value={adminUsername}
                onChange={(event) => setAdminUsername(event.target.value)}
                autoFocus
                autoComplete="username"
              />
            </label>
          )}

          <label className="form-label">
            {effectiveMode === "admin" ? "PostgreSQL administrator password" : "Password"}
            <div className="password-input-wrap">
              <input
                className="form-input password-input-field"
                type={passwordVisible ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoFocus={effectiveMode !== "admin"}
              />
              <button
                type="button"
                className="password-visibility-btn"
                aria-label={passwordVisible ? "Hide password" : "Show password"}
                aria-pressed={passwordVisible}
                onClick={() => setPasswordVisible((current) => !current)}
              >
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
              </button>
            </div>
          </label>

          {authStatus ? (
            <p className="auth-hint">
              Registered PostgreSQL app users: {authStatus.registeredUserCount}
              <br />
              Sessions end when Kanqual closes.
            </p>
          ) : null}

          {error ? <p className="auth-error">{error}</p> : null}

          <div className="form-actions">
            <button type="button" className="btn" onClick={() => void onRefresh()} disabled={submitting}>
              Refresh
            </button>
            <button type="submit" className="btn btn--primary" disabled={submitting}>
              {submitting
                ? "Please wait..."
                : effectiveMode === "register"
                  ? "Create account"
                  : "Sign in"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
