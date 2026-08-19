import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  completePostgresAdminHandoff,
  createPostgresAppUser,
  getBundledPostgresInitPreflight,
  initializeBundledPostgresCluster,
  listPostgresRememberedAccounts,
  loginPostgresAdmin,
  loginPostgresAppUser,
  rememberPostgresAccount,
  restorePostgresUpgradeBackup,
  type BundledPostgresInitPreflight,
  type PostgresAuthSession,
  type PostgresAuthStatus,
  type PostgresRememberedAccount,
  type RestorePostgresUpgradeBackupResult,
  type PostgresStatus,
} from "../lib/postgres";
import { formatCurrentDateTime } from "../i18n/formatters";
import {
  getPostgresAccounts,
  savePostgresAccount as savePostgresAccountHistory,
} from "../lib/authHistory";
import { ComputerIcon, NetworkIcon } from "../components/AppIcons";
import { LoadingCard } from "../components/LoadingCard";

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function PostgresStartupLoadingView() {
  return (
    <div className="auth-screen">
      <LoadingCard />
    </div>
  );
}

function AuthSlideCard({
  stage,
  children,
  className = "",
}: {
  stage: string;
  children: ReactNode;
  className?: string;
}) {
  const lastCardRef = useRef<{ stage: string; content: ReactNode }>({ stage, content: children });
  const [exitingCard, setExitingCard] = useState<{ stage: string; content: ReactNode } | null>(null);

  useEffect(() => {
    if (lastCardRef.current.stage === stage) {
      lastCardRef.current = { stage, content: children };
      return;
    }

    setExitingCard(lastCardRef.current);
    lastCardRef.current = { stage, content: children };
    const timeout = window.setTimeout(() => setExitingCard(null), 280);
    return () => window.clearTimeout(timeout);
  }, [stage, children]);

  return (
    <div className="auth-card-transition-shell">
      {exitingCard ? (
        <div
          key={`exit-${exitingCard.stage}`}
          className={`auth-card auth-card-transition-card auth-card-transition-card--exit ${className}`}
          aria-hidden="true"
        >
          {exitingCard.content}
        </div>
      ) : null}
      <div
        key={stage}
        className={`auth-card auth-card-transition-card auth-card-transition-card--enter ${className}`}
      >
        {children}
      </div>
    </div>
  );
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

function defaultNameFromUsername(username: string): string {
  return username.trim() || username;
}

function mergeRememberedAccounts(
  primaryAccounts: PostgresRememberedAccount[],
  fallbackAccounts: PostgresRememberedAccount[],
): PostgresRememberedAccount[] {
  const byEmail = new Map<string, PostgresRememberedAccount>();
  [...fallbackAccounts, ...primaryAccounts].forEach((account) => {
    const email = account.email.trim().toLowerCase();
    if (!email) return;
    const existing = byEmail.get(email);
    if (!existing || new Date(account.lastLogin).getTime() > new Date(existing.lastLogin).getTime()) {
      byEmail.set(email, {
        email,
        name: account.name || email,
        lastLogin: account.lastLogin,
      });
    }
  });
  return Array.from(byEmail.values())
    .sort((left, right) => new Date(right.lastLogin).getTime() - new Date(left.lastLogin).getTime())
    .slice(0, 20);
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

export type PostgresAdminHandoffViewProps = {
  status: PostgresStatus;
  onComplete: (nextStatus: PostgresStatus) => void | Promise<void>;
};

export function PostgresAdminHandoffView({
  status,
  onComplete,
}: PostgresAdminHandoffViewProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
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
        newSuperuserPassword: password,
      });
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
        <form onSubmit={handleSubmit} className="form">
          <h2 className="auth-panel-title">Finish local database admin setup</h2>
          <p className="auth-hint">
            KanQual has already initialized the local database{" "}
            <code>{status.appDatabase}</code>.
          </p>
          <div className="settings-warning settings-warning--danger">
            Set the PostgreSQL administrator password now. Kanqual will not be able to recover it for you after this handoff completes.
          </div>
          <label className="form-label">
            New PostgreSQL admin password
            <div className="password-input-wrap">
              <input
                className="form-input password-input-field"
                type={passwordVisible ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                name="new-postgres-admin-password"
                autoComplete="new-password"
              />
              <button
                type="button"
                className="password-visibility-btn"
                aria-label={passwordVisible ? "Hide password" : "Show password"}
                aria-pressed={passwordVisible}
                onClick={() => setPasswordVisible((current) => !current)}
              >
                <PasswordVisibilityIcon />
              </button>
            </div>
            <p className="password-requirement-note">Minimum 8 characters.</p>
          </label>
          <label className="form-label">
            Confirm PostgreSQL admin password
            <div className="password-input-wrap">
              <input
                className="form-input password-input-field"
                type={confirmPasswordVisible ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                name="confirm-postgres-admin-password"
                autoComplete="new-password"
              />
              <button
                type="button"
                className="password-visibility-btn"
                aria-label={confirmPasswordVisible ? "Hide password" : "Show password"}
                aria-pressed={confirmPasswordVisible}
                onClick={() => setConfirmPasswordVisible((current) => !current)}
              >
                <PasswordVisibilityIcon />
              </button>
            </div>
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

export type PostgresLaunchViewProps = {
  status: PostgresStatus | null;
  loading: boolean;
  onBootstrap: (superuserPassword: string) => Promise<void>;
  onRestored?: () => Promise<void> | void;
  onAuthenticated: (session: PostgresAuthSession) => void | Promise<void>;
  onFirstAccountCreated?: (session: PostgresAuthSession) => void | Promise<void>;
  onOpenPostgresProjects: () => void;
};

export function PostgresLaunchView({
  status,
  loading,
  onBootstrap,
  onRestored,
  onAuthenticated,
  onFirstAccountCreated,
  onOpenPostgresProjects,
}: PostgresLaunchViewProps) {
  const [superuserPassword, setSuperuserPassword] = useState("");
  const [initialAdminPassword, setInitialAdminPassword] = useState("");
  const [confirmInitialAdminPassword, setConfirmInitialAdminPassword] = useState("");
  const [showFirstAccountSetup, setShowFirstAccountSetup] = useState(false);
  const [firstAccountPassword, setFirstAccountPassword] = useState("");
  const [confirmFirstAccountPassword, setConfirmFirstAccountPassword] = useState("");
  const [firstAccountEmail, setFirstAccountEmail] = useState("");
  const [firstAccountPasswordVisible, setFirstAccountPasswordVisible] = useState(false);
  const [confirmFirstAccountPasswordVisible, setConfirmFirstAccountPasswordVisible] = useState(false);
  const [superuserPasswordVisible, setSuperuserPasswordVisible] = useState(false);
  const [initialAdminPasswordVisible, setInitialAdminPasswordVisible] = useState(false);
  const [confirmInitialAdminPasswordVisible, setConfirmInitialAdminPasswordVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [bundledPreflight, setBundledPreflight] = useState<BundledPostgresInitPreflight | null>(null);
  const [bundledPreflightLoading, setBundledPreflightLoading] = useState(true);
  const [firstRunSetupMode, setFirstRunSetupMode] = useState<"setup" | "restore">("setup");
  const [restoreBackupPath, setRestoreBackupPath] = useState("");
  const [restoreBackupPassword, setRestoreBackupPassword] = useState("");
  const [restoreBackupPasswordVisible, setRestoreBackupPasswordVisible] = useState(false);
  const [restoreAdminPassword, setRestoreAdminPassword] = useState("");
  const [confirmRestoreAdminPassword, setConfirmRestoreAdminPassword] = useState("");
  const [restoreAdminPasswordVisible, setRestoreAdminPasswordVisible] = useState(false);
  const [confirmRestoreAdminPasswordVisible, setConfirmRestoreAdminPasswordVisible] = useState(false);
  const [restoreSuccess, setRestoreSuccess] = useState<RestorePostgresUpgradeBackupResult | null>(null);

  const bootstrapApplied = !!status?.bootstrapApplied;
  const adminHandoffCompleted = !!status?.adminHandoffCompleted;
  const databaseReady = bootstrapApplied && adminHandoffCompleted;
  const bundledClusterInitialized = !!bundledPreflight?.status.initialized;
  const showingFirstAccountSetup = showFirstAccountSetup;
  const initializingBundledCluster =
    submitting && !showingFirstAccountSetup && !bundledClusterInitialized && !!bundledPreflight;

  useEffect(() => {
    let cancelled = false;

    async function loadBundledPreflight() {
      setBundledPreflightLoading(true);
      try {
        const nextPreflight = await getBundledPostgresInitPreflight();
        if (!cancelled) {
          setBundledPreflight(nextPreflight);
        }
      } catch (preflightError) {
        if (!cancelled) {
          setError(describeUnknownError(preflightError));
          setBundledPreflight(null);
        }
      } finally {
        if (!cancelled) {
          setBundledPreflightLoading(false);
        }
      }
    }

    void loadBundledPreflight();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleInitializeBundledPostgres(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (initialAdminPassword.length < 8) {
      setError("Choose a PostgreSQL administrator password with at least 8 characters.");
      return;
    }
    if (initialAdminPassword !== confirmInitialAdminPassword) {
      setError("The PostgreSQL administrator passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      await initializeBundledPostgresCluster(initialAdminPassword);
      setShowFirstAccountSetup(true);
      setInitialAdminPassword("");
      setConfirmInitialAdminPassword("");
      const nextPreflight = await getBundledPostgresInitPreflight();
      setBundledPreflight(nextPreflight);
      setNotice("");
    } catch (initializeError) {
      setError(describeUnknownError(initializeError));
    } finally {
      setSubmitting(false);
    }
  }

  async function chooseRestoreBackupFile() {
    setError("");
    const selected = await openDialog({
      multiple: false,
      directory: false,
      title: "Choose KanQual upgrade backup",
      filters: [
        {
          name: "KanQual upgrade backup",
          extensions: ["kanqual-upgrade-backup"],
        },
      ],
    });
    if (typeof selected === "string") {
      setRestoreBackupPath(selected);
    }
  }

  async function handleRestoreUpgradeBackup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!restoreBackupPath.trim()) {
      setError("Choose a KanQual upgrade backup file.");
      return;
    }
    if (!restoreBackupPassword.trim()) {
      setError("Enter the password for the upgrade backup.");
      return;
    }
    if (restoreAdminPassword.length < 8) {
      setError("Choose a new administrator password with at least 8 characters.");
      return;
    }
    if (restoreAdminPassword !== confirmRestoreAdminPassword) {
      setError("The new administrator passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await restorePostgresUpgradeBackup({
        backupPath: restoreBackupPath,
        backupPassword: restoreBackupPassword,
        newAdminPassword: restoreAdminPassword,
      });
      setRestoreBackupPath("");
      setRestoreBackupPassword("");
      setRestoreAdminPassword("");
      setConfirmRestoreAdminPassword("");
      setRestoreBackupPasswordVisible(false);
      setRestoreAdminPasswordVisible(false);
      setConfirmRestoreAdminPasswordVisible(false);
      setRestoreSuccess(result);
    } catch (restoreError) {
      setError(describeUnknownError(restoreError));
    } finally {
      setSubmitting(false);
    }
  }

  async function finishRestoreSuccess() {
    setRestoreSuccess(null);
    await onRestored?.();
  }

  async function handleBootstrapSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!superuserPassword) {
      setError("Enter the PostgreSQL administrator password to finish setup.");
      return;
    }

    setSubmitting(true);
    try {
      await onBootstrap(superuserPassword);
      setSuperuserPassword("");
      setNotice("Database setup is complete.");
    } catch (bootstrapError) {
      setError(bootstrapError instanceof Error ? bootstrapError.message : String(bootstrapError));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFirstAccountSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    const email = firstAccountEmail.trim().toLowerCase();
    if (!email) {
      setError("Enter a username.");
      return;
    }
    if (/\s/.test(email)) {
      setError("Usernames cannot contain spaces.");
      return;
    }
    if (firstAccountPassword.length < 8) {
      setError("Choose a password with at least 8 characters.");
      return;
    }
    if (firstAccountPassword !== confirmFirstAccountPassword) {
      setError("The passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      await createPostgresAppUser({
        name: defaultNameFromUsername(email),
        username: email,
        password: firstAccountPassword,
      });
      const session = await loginPostgresAppUser({
        username: email,
        password: firstAccountPassword,
        rememberSession: false,
      });
      try {
        await rememberPostgresAccount(email, session.user.name || session.user.username || email);
      } catch (rememberError) {
        console.warn("Could not remember PostgreSQL account:", describeUnknownError(rememberError));
      }
      setShowFirstAccountSetup(false);
      setFirstAccountPassword("");
      setConfirmFirstAccountPassword("");
      setFirstAccountEmail("");
      await (onFirstAccountCreated ?? onAuthenticated)(session);
    } catch (setupError) {
      setError(describeUnknownError(setupError));
    } finally {
      setSubmitting(false);
    }
  }

  if (bundledPreflightLoading) {
    return <PostgresStartupLoadingView />;
  }

  if (initializingBundledCluster) {
    return <PostgresStartupLoadingView />;
  }

  const launchStage = restoreSuccess
    ? "restore-success"
    : showingFirstAccountSetup
      ? "first-account"
      : bundledPreflight && !bundledClusterInitialized
        ? firstRunSetupMode === "restore" ? "restore-backup" : "admin-password"
        : bundledClusterInitialized && !bootstrapApplied
          ? "resume-bootstrap"
          : bootstrapApplied && !adminHandoffCompleted
            ? "incomplete-handoff"
            : databaseReady
              ? "database-ready"
              : "launch-idle";
  const initialAdminPasswordMismatch =
    confirmInitialAdminPassword.length > 0 && initialAdminPassword !== confirmInitialAdminPassword;
  const firstAccountPasswordMismatch =
    confirmFirstAccountPassword.length > 0 && firstAccountPassword !== confirmFirstAccountPassword;
  const restoreAdminPasswordMismatch =
    confirmRestoreAdminPassword.length > 0 && restoreAdminPassword !== confirmRestoreAdminPassword;

  return (
    <div className="auth-screen">
      <AuthSlideCard stage={launchStage}>
        <div className="auth-brand-row">
          <img src="/logo.png" alt="" className="auth-brand-row-logo" />
          <div className="auth-brand">KanQual</div>
        </div>
        <div className="form">
          {restoreSuccess ? (
            <div className="form" role="status" aria-live="polite">
              <div className="auth-admin-notice">
                <strong>Import Complete</strong>
                <span>KanQual finished importing the backup.</span>
              </div>
              <div className="settings-diagnostics-grid settings-diagnostics-grid--compact">
                <div>
                  <span>Backup Version</span>
                  <strong>{restoreSuccess.backupKanqualVersion}</strong>
                </div>
                <div>
                  <span>Projects</span>
                  <strong>{restoreSuccess.projectCount}</strong>
                </div>
                <div>
                  <span>Files</span>
                  <strong>{restoreSuccess.storageFileCount}</strong>
                </div>
                <div>
                  <span>Users</span>
                  <strong>{restoreSuccess.userCount}</strong>
                </div>
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn--primary" onClick={() => void finishRestoreSuccess()}>
                  Done
                </button>
              </div>
            </div>
          ) : showingFirstAccountSetup ? (
            <form onSubmit={handleFirstAccountSubmit} className="form">
              <div className="settings-warning settings-warning--danger">
                Create your local KanQual user account.
                <br />
                <br />
                This account is separate from the administrator password you just created.
              </div>
              <label className="form-label">
                Username
                <input
                  className="form-input"
                  type="text"
                  value={firstAccountEmail}
                  onChange={(e) => setFirstAccountEmail(e.target.value)}
                  autoComplete="username"
                />
              </label>
              <label className="form-label">
                Password
                <div className="password-input-wrap">
                  <input
                    className="form-input password-input-field"
                    type={firstAccountPasswordVisible ? "text" : "password"}
                    value={firstAccountPassword}
                    onChange={(e) => setFirstAccountPassword(e.target.value)}
                    autoFocus
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="password-visibility-btn"
                    aria-label={firstAccountPasswordVisible ? "Hide password" : "Show password"}
                    aria-pressed={firstAccountPasswordVisible}
                    onClick={() => setFirstAccountPasswordVisible((current) => !current)}
                  >
                    <PasswordVisibilityIcon />
                  </button>
                </div>
                <p className="password-requirement-note">Minimum 8 characters.</p>
              </label>
              <label className="form-label">
                Confirm Password
                <div className="password-input-wrap">
                  <input
                    className="form-input password-input-field"
                    type={confirmFirstAccountPasswordVisible ? "text" : "password"}
                    value={confirmFirstAccountPassword}
                    onChange={(e) => setConfirmFirstAccountPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="password-visibility-btn"
                    aria-label={confirmFirstAccountPasswordVisible ? "Hide password" : "Show password"}
                    aria-pressed={confirmFirstAccountPasswordVisible}
                    onClick={() => setConfirmFirstAccountPasswordVisible((current) => !current)}
                  >
                    <PasswordVisibilityIcon />
                  </button>
                </div>
              </label>
              {firstAccountPasswordMismatch ? (
                <p className="settings-warning settings-warning--danger" style={{ margin: 0 }}>
                  The password entries do not match.
                </p>
              ) : null}
              <div className="form-actions">
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={
                    submitting ||
                    !firstAccountEmail.trim() ||
                    firstAccountPassword.length < 8 ||
                    !confirmFirstAccountPassword ||
                    firstAccountPasswordMismatch
                  }
                >
                  {submitting ? "Creating..." : "Create account"}
                </button>
              </div>
            </form>
          ) : !bundledPreflightLoading && bundledPreflight && !bundledClusterInitialized && (
            <>
              <div className="segmented-control modal-segmented-control" role="group" aria-label="First launch setup mode">
                {[
                  { value: "setup", label: "New" },
                  { value: "restore", label: "Restore" },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={firstRunSetupMode === option.value ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                    onClick={() => {
                      setFirstRunSetupMode(option.value as "setup" | "restore");
                      setError("");
                      setNotice("");
                    }}
                    disabled={submitting}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {firstRunSetupMode === "restore" ? (
                <form onSubmit={handleRestoreUpgradeBackup} className="form">
                  <div className="settings-warning settings-warning--danger">
                    Restore a KanQual upgrade backup into this fresh installation. The backup password only unlocks the file; set a new administrator password for this installation. Restored users must have their passwords reset by an administrator before signing in.
                  </div>
                  {bundledPreflight.issues.length ? (
                    <div className="settings-warning">
                      {bundledPreflight.issues.join(" ")}
                    </div>
                  ) : null}
                  <label className="form-label">
                    Backup File
                    <div className="form-inline-action-row">
                      <input
                        className="form-input"
                        type="text"
                        value={restoreBackupPath}
                        readOnly
                        placeholder="No backup selected"
                      />
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void chooseRestoreBackupFile()}
                        disabled={submitting}
                      >
                        Choose
                      </button>
                    </div>
                  </label>
                  <label className="form-label">
                    Backup Password
                    <div className="password-input-wrap">
                      <input
                        className="form-input password-input-field"
                        type={restoreBackupPasswordVisible ? "text" : "password"}
                        value={restoreBackupPassword}
                        onChange={(e) => setRestoreBackupPassword(e.target.value)}
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        className="password-visibility-btn"
                        aria-label={restoreBackupPasswordVisible ? "Hide password" : "Show password"}
                        aria-pressed={restoreBackupPasswordVisible}
                        onClick={() => setRestoreBackupPasswordVisible((current) => !current)}
                      >
                        <PasswordVisibilityIcon />
                      </button>
                    </div>
                  </label>
                  <label className="form-label">
                    New Administrator Password
                    <div className="password-input-wrap">
                      <input
                        className="form-input password-input-field"
                        type={restoreAdminPasswordVisible ? "text" : "password"}
                        value={restoreAdminPassword}
                        onChange={(e) => setRestoreAdminPassword(e.target.value)}
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        className="password-visibility-btn"
                        aria-label={restoreAdminPasswordVisible ? "Hide password" : "Show password"}
                        aria-pressed={restoreAdminPasswordVisible}
                        onClick={() => setRestoreAdminPasswordVisible((current) => !current)}
                      >
                        <PasswordVisibilityIcon />
                      </button>
                    </div>
                    <p className="password-requirement-note">Minimum 8 characters.</p>
                  </label>
                  <label className="form-label">
                    Confirm Password
                    <div className="password-input-wrap">
                      <input
                        className="form-input password-input-field"
                        type={confirmRestoreAdminPasswordVisible ? "text" : "password"}
                        value={confirmRestoreAdminPassword}
                        onChange={(e) => setConfirmRestoreAdminPassword(e.target.value)}
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        className="password-visibility-btn"
                        aria-label={confirmRestoreAdminPasswordVisible ? "Hide password" : "Show password"}
                        aria-pressed={confirmRestoreAdminPasswordVisible}
                        onClick={() => setConfirmRestoreAdminPasswordVisible((current) => !current)}
                      >
                        <PasswordVisibilityIcon />
                      </button>
                    </div>
                  </label>
                  {restoreAdminPasswordMismatch ? (
                    <p className="settings-warning settings-warning--danger" style={{ margin: 0 }}>
                      The password entries do not match.
                    </p>
                  ) : null}
                  <div className="form-actions">
                    <button
                      type="submit"
                      className="btn btn--primary"
                      disabled={
                        loading ||
                        submitting ||
                        !bundledPreflight.canInitialize ||
                        !restoreBackupPath.trim() ||
                        !restoreBackupPassword.trim() ||
                        restoreAdminPassword.length < 8 ||
                        !confirmRestoreAdminPassword ||
                        restoreAdminPasswordMismatch
                      }
                    >
                      {submitting ? "Restoring..." : "Restore"}
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleInitializeBundledPostgres} className="form">
                  <div className="settings-warning settings-warning--danger">
                    This is the first time KanQual is starting. Set an administrator password to finish setup. These credentials are critical and cannot be recovered. Please make sure you retain them securely.
                  </div>
                  {bundledPreflight.issues.length ? (
                    <div className="settings-warning">
                      {bundledPreflight.issues.join(" ")}
                    </div>
                  ) : null}
                  <label className="form-label">
                    Administrator Password
                    <div className="password-input-wrap">
                      <input
                        className="form-input password-input-field"
                        type={initialAdminPasswordVisible ? "text" : "password"}
                        value={initialAdminPassword}
                        onChange={(e) => setInitialAdminPassword(e.target.value)}
                        name="postgres-admin-password"
                        autoFocus
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        className="password-visibility-btn"
                        aria-label={initialAdminPasswordVisible ? "Hide password" : "Show password"}
                        aria-pressed={initialAdminPasswordVisible}
                        onClick={() => setInitialAdminPasswordVisible((current) => !current)}
                      >
                        <PasswordVisibilityIcon />
                      </button>
                    </div>
                    <p className="password-requirement-note">Minimum 8 characters.</p>
                  </label>
                  <label className="form-label">
                    Confirm Password
                    <div className="password-input-wrap">
                      <input
                        className="form-input password-input-field"
                        type={confirmInitialAdminPasswordVisible ? "text" : "password"}
                        value={confirmInitialAdminPassword}
                        onChange={(e) => setConfirmInitialAdminPassword(e.target.value)}
                        name="confirm-postgres-admin-password"
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        className="password-visibility-btn"
                        aria-label={confirmInitialAdminPasswordVisible ? "Hide password" : "Show password"}
                        aria-pressed={confirmInitialAdminPasswordVisible}
                        onClick={() => setConfirmInitialAdminPasswordVisible((current) => !current)}
                      >
                        <PasswordVisibilityIcon />
                      </button>
                    </div>
                  </label>
                  {initialAdminPasswordMismatch ? (
                    <p className="settings-warning settings-warning--danger" style={{ margin: 0 }}>
                      The password entries do not match.
                    </p>
                  ) : null}
                  <div className="form-actions">
                    <button
                      type="submit"
                      className="btn btn--primary"
                      disabled={loading || submitting || !bundledPreflight.canInitialize || initialAdminPasswordMismatch}
                    >
                      {submitting ? "Submitting..." : "Submit"}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}

          {!showingFirstAccountSetup && bundledClusterInitialized && !bootstrapApplied && (
            <form onSubmit={handleBootstrapSubmit} className="form">
              <div className="settings-warning settings-warning--danger">
                Database setup did not finish. Enter the administrator password you created when KanQual first started.
              </div>
              <label className="form-label">
                Administrator Password
                <div className="password-input-wrap">
                  <input
                    className="form-input password-input-field"
                    type={superuserPasswordVisible ? "text" : "password"}
                    value={superuserPassword}
                    onChange={(e) => setSuperuserPassword(e.target.value)}
                    name="postgres-superuser-password"
                    autoFocus
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="password-visibility-btn"
                    aria-label={superuserPasswordVisible ? "Hide password" : "Show password"}
                    aria-pressed={superuserPasswordVisible}
                    onClick={() => setSuperuserPasswordVisible((current) => !current)}
                  >
                    <PasswordVisibilityIcon />
                  </button>
                </div>
              </label>
              <div className="form-actions">
                <button type="submit" className="btn btn--primary" disabled={loading || submitting}>
                  {submitting ? "Finishing..." : "Finish setup"}
                </button>
              </div>
            </form>
          )}

          {!showingFirstAccountSetup && bootstrapApplied && !adminHandoffCompleted && (
            <>
              <div className="settings-warning settings-warning--danger">
                Database setup is incomplete. Refresh the status, then finish setup if Kanqual asks for the administrator password again.
              </div>
            </>
          )}

          {!showingFirstAccountSetup && databaseReady && (
            <>
              <div className="settings-warning">
                <strong>Ready</strong>
                <br />
                The bundled PostgreSQL runtime is ready. Continue into projects to sign in and open a workspace.
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn--primary" onClick={onOpenPostgresProjects}>
                  Open PostgreSQL projects
                </button>
              </div>
            </>
          )}

          {notice ? <p className="settings-success">{notice}</p> : null}
          {error ? <p className="auth-error">{error}</p> : null}
        </div>
      </AuthSlideCard>
    </div>
  );
}

export type PostgresAuthViewProps = {
  authStatus: PostgresAuthStatus | null;
  onRefresh: () => Promise<void>;
  onAuthenticated: (session: PostgresAuthSession, currentPassword?: string) => void | Promise<void>;
  onFirstAccountCreated?: (session: PostgresAuthSession) => void | Promise<void>;
};

export function PostgresAuthView({
  authStatus,
  onAuthenticated,
  onFirstAccountCreated,
}: PostgresAuthViewProps) {
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [signInStep, setSignInStep] = useState<"username" | "password">("username");
  const [email, setEmail] = useState("");
  const [recentAccounts, setRecentAccounts] = useState<PostgresRememberedAccount[]>(() =>
    mergeRememberedAccounts([], getPostgresAccounts()),
  );
  const [selectedRecentEmail, setSelectedRecentEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmFirstAccountPassword, setConfirmFirstAccountPassword] = useState("");
  const [confirmFirstAccountPasswordVisible, setConfirmFirstAccountPasswordVisible] = useState(false);
  const [firstAccountEmail, setFirstAccountEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const selectedRecentAccount = selectedRecentEmail
    ? recentAccounts.find((account) => account.email === selectedRecentEmail) ?? null
    : null;
  const firstAccountPasswordMismatch =
    confirmFirstAccountPassword.length > 0 && password !== confirmFirstAccountPassword;

  useEffect(() => {
    let cancelled = false;

    async function loadRecentAccounts() {
      try {
        const nextAccounts = await listPostgresRememberedAccounts();
        if (!cancelled) {
          setRecentAccounts(mergeRememberedAccounts(nextAccounts, getPostgresAccounts()));
        }
      } catch (loadError) {
        if (!cancelled) {
          console.warn("Could not load remembered PostgreSQL accounts:", describeUnknownError(loadError));
          setRecentAccounts(mergeRememberedAccounts([], getPostgresAccounts()));
        }
      }
    }

    void loadRecentAccounts();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleFirstAccountSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const email = firstAccountEmail.trim().toLowerCase();
    if (!email) {
      setError("Enter a username.");
      return;
    }
    if (/\s/.test(email)) {
      setError("Usernames cannot contain spaces.");
      return;
    }
    if (password.length < 8) {
      setError("Choose a password with at least 8 characters.");
      return;
    }
    if (password !== confirmFirstAccountPassword) {
      setError("The passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      await createPostgresAppUser({
        name: defaultNameFromUsername(email),
        username: email,
        password,
      });
      const session = await loginPostgresAppUser({
        username: email,
        password,
        rememberSession: false,
      });
      savePostgresAccountHistory(email, session.user.name || session.user.username || email);
      setRecentAccounts(mergeRememberedAccounts([], getPostgresAccounts()));
      try {
        await rememberPostgresAccount(email, session.user.name || session.user.username || email);
        setRecentAccounts(mergeRememberedAccounts(await listPostgresRememberedAccounts(), getPostgresAccounts()));
      } catch (rememberError) {
        console.warn("Could not remember PostgreSQL account:", describeUnknownError(rememberError));
      }
      setFirstAccountEmail("");
      setPassword("");
      setConfirmFirstAccountPassword("");
      await (onFirstAccountCreated ?? onAuthenticated)(session);
    } catch (setupError) {
      setError(describeUnknownError(setupError));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (showAdminLogin) {
      if (!password) {
        setError("Enter the PostgreSQL administrator password.");
        return;
      }
      setSubmitting(true);
      try {
        const session = await loginPostgresAdmin({
          password,
          rememberSession: false,
        });
        setPassword("");
        await onAuthenticated(session);
      } catch (authError) {
        setError(describeUnknownError(authError));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();
    if (signInStep === "username") {
      if (!trimmedEmail) {
        setError("Enter your username.");
        return;
      }
      if (/\s/.test(trimmedEmail)) {
        setError("Usernames cannot contain spaces.");
        return;
      }
      setEmail(trimmedEmail);
      setPassword("");
      setPasswordVisible(false);
      setSignInStep("password");
      return;
    }

    if (!trimmedEmail) {
      setError("Enter your username.");
      return;
    }
    if (/\s/.test(trimmedEmail)) {
      setError("Usernames cannot contain spaces.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }

    setSubmitting(true);
    try {
      const session = await loginPostgresAppUser({
        username: trimmedEmail,
        password,
        rememberSession: false,
      });
      savePostgresAccountHistory(trimmedEmail, session.user.name || session.user.username || trimmedEmail);
      setRecentAccounts(mergeRememberedAccounts([], getPostgresAccounts()));
      try {
        await rememberPostgresAccount(trimmedEmail, session.user.name || session.user.username || trimmedEmail);
        setRecentAccounts(mergeRememberedAccounts(await listPostgresRememberedAccounts(), getPostgresAccounts()));
      } catch (rememberError) {
        console.warn("Could not update PostgreSQL remembered accounts:", describeUnknownError(rememberError));
      }
      const submittedPassword = password;
      setPassword("");
      onAuthenticated(session, submittedPassword);
    } catch (authError) {
      setError(describeUnknownError(authError));
    } finally {
      setSubmitting(false);
    }
  }

  if (authStatus?.requiresAccountSetup && authStatus.currentSession?.authKind === "postgres_admin") {
    return (
      <div className="auth-screen">
        <div className="auth-card" style={{ maxWidth: 720 }}>
          <div className="auth-brand-row">
            <img src="/logo.png" alt="" className="auth-brand-row-logo" />
            <div className="auth-brand">KanQual</div>
          </div>
          <form onSubmit={handleFirstAccountSubmit} className="form">
            <div className="settings-warning settings-warning--danger">
              Create your local KanQual user account.
              <br />
              <br />
              This account is separate from the administrator password you just created.
            </div>
            <label className="form-label">
              Username
              <input
                className="form-input"
                type="text"
                value={firstAccountEmail}
                onChange={(event) => setFirstAccountEmail(event.target.value)}
                autoFocus
                autoComplete="username"
              />
            </label>
            <label className="form-label">
              Password
              <div className="password-input-wrap">
                <input
                  className="form-input password-input-field"
                  type={passwordVisible ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="password-visibility-btn"
                  aria-label={passwordVisible ? "Hide password" : "Show password"}
                  aria-pressed={passwordVisible}
                  onClick={() => setPasswordVisible((current) => !current)}
                >
                  <PasswordVisibilityIcon />
                </button>
              </div>
              <p className="password-requirement-note">Minimum 8 characters.</p>
            </label>
            <label className="form-label">
              Confirm Password
              <div className="password-input-wrap">
                <input
                  className="form-input password-input-field"
                  type={confirmFirstAccountPasswordVisible ? "text" : "password"}
                  value={confirmFirstAccountPassword}
                  onChange={(event) => setConfirmFirstAccountPassword(event.target.value)}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="password-visibility-btn"
                  aria-label={confirmFirstAccountPasswordVisible ? "Hide password" : "Show password"}
                  aria-pressed={confirmFirstAccountPasswordVisible}
                  onClick={() => setConfirmFirstAccountPasswordVisible((current) => !current)}
                >
                  <PasswordVisibilityIcon />
                </button>
              </div>
            </label>
            {firstAccountPasswordMismatch ? (
              <p className="settings-warning settings-warning--danger" style={{ margin: 0 }}>
                The password entries do not match.
              </p>
            ) : null}
            {error ? <p className="auth-error">{error}</p> : null}
            <div className="form-actions">
              <button
                type="submit"
                className="btn btn--primary"
                disabled={
                  submitting ||
                  !firstAccountEmail.trim() ||
                  password.length < 8 ||
                  !confirmFirstAccountPassword ||
                  firstAccountPasswordMismatch
                }
              >
                {submitting ? "Creating..." : "Create account"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  if (showAdminLogin) {
    return (
      <div className="auth-screen">
        <div className="auth-card" style={{ maxWidth: 720 }}>
          <div className="auth-brand-row">
            <img src="/logo.png" alt="" className="auth-brand-row-logo" />
            <div className="auth-brand">KanQual</div>
          </div>
          <form onSubmit={handleSubmit} className="form">
            <div className="auth-admin-notice">
              <strong>Built-in local administrator</strong>
              <span>
                Sign in with the administrator credentials you created when you first launched KanQual.
              </span>
            </div>

            <label className="form-label">
              PostgreSQL administrator password
              <div className="password-input-wrap">
                <input
                  className="form-input password-input-field"
                  type={passwordVisible ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoFocus
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="password-visibility-btn"
                  aria-label={passwordVisible ? "Hide password" : "Show password"}
                  aria-pressed={passwordVisible}
                  onClick={() => setPasswordVisible((current) => !current)}
                >
                  <PasswordVisibilityIcon />
                </button>
              </div>
            </label>

            {error ? <p className="auth-error">{error}</p> : null}

            <div className="form-actions">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setShowAdminLogin(false);
                  setPassword("");
                  setError("");
                }}
                disabled={submitting}
              >
                Back
              </button>
              <button type="submit" className="btn btn--primary" disabled={submitting}>
                {submitting ? "Please wait..." : "Sign in"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-card" style={{ maxWidth: 720 }}>
        <div className="auth-brand-row">
          <img src="/logo.png" alt="" className="auth-brand-row-logo" />
          <div className="auth-brand">KanQual</div>
        </div>
        <form onSubmit={handleSubmit} className="form">
          {signInStep === "username" && recentAccounts.length > 0 ? (
            <div className="auth-recent-accounts">
              <div className="auth-recent-accounts-title">Recent accounts</div>
              <ul className="account-list auth-recent-account-list">
                {recentAccounts.map((account) => (
                  <li
                    key={account.email}
                    className="account-item auth-recent-account-item"
                    onClick={() => {
                      setEmail(account.email);
                      setSelectedRecentEmail(account.email);
                      setSignInStep("password");
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
            </div>
          ) : null}

          {signInStep === "password" ? (
            <div className="auth-admin-notice auth-user-notice">
              <div className="account-avatar">{accountInitials(selectedRecentAccount?.name || email)}</div>
              <div className="account-info">
                <div className="account-name">{selectedRecentAccount?.name || email}</div>
                <div className="account-email">{selectedRecentAccount?.email || email}</div>
              </div>
            </div>
          ) : null}

          {signInStep === "username" ? (
            <label className="form-label">
              Username
              <input
                className="form-input"
                type="text"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setSelectedRecentEmail("");
                  setSignInStep("username");
                }}
                autoFocus
                autoComplete="username"
              />
            </label>
          ) : null}

          {signInStep === "password" ? (
            <label className="form-label">
              Password
              <div className="password-input-wrap">
                <input
                  className="form-input password-input-field"
                  type={passwordVisible ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoFocus
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="password-visibility-btn"
                  aria-label={passwordVisible ? "Hide password" : "Show password"}
                  aria-pressed={passwordVisible}
                  onClick={() => setPasswordVisible((current) => !current)}
                >
                  <PasswordVisibilityIcon />
                </button>
              </div>
            </label>
          ) : null}

          {error ? <p className="auth-error">{error}</p> : null}

          <div className="form-actions auth-actions--split">
            {signInStep === "password" ? (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setSignInStep("username");
                  setPassword("");
                  setPasswordVisible(false);
                  setSelectedRecentEmail("");
                  setError("");
                }}
                disabled={submitting}
              >
                Back
              </button>
            ) : (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setShowAdminLogin(true);
                  setPassword("");
                  setError("");
                }}
                disabled={submitting}
              >
                Administrator
              </button>
            )}
            <button type="submit" className="btn btn--primary" disabled={submitting}>
              {submitting ? "Please wait..." : signInStep === "username" ? "Next" : "Sign in"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export type PostgresWorkspaceModeChoiceViewProps = {
  onUseLocal: () => void;
};

export function PostgresWorkspaceModeChoiceView({
  onUseLocal,
}: PostgresWorkspaceModeChoiceViewProps) {
  const [showRemoteForm, setShowRemoteForm] = useState(false);
  const [remoteAddress, setRemoteAddress] = useState("");

  return (
    <div className="auth-screen">
      <AuthSlideCard stage={showRemoteForm ? "remote-connection" : "workspace-mode"}>
        <div className="auth-brand-row">
          <img src="/logo.png" alt="" className="auth-brand-row-logo" />
          <div className="auth-brand">KanQual</div>
        </div>
        {!showRemoteForm ? (
          <div className="form">
            <div className="mode-options mode-options--auth-card">
              <button type="button" className="mode-option" onClick={onUseLocal}>
                <ComputerIcon className="mode-option-icon" />
                <span className="mode-option-title">Local</span>
                <span className="mode-option-desc">Work with projects stored on this machine.</span>
              </button>
              <button type="button" className="mode-option" onClick={() => setShowRemoteForm(true)}>
                <NetworkIcon className="mode-option-icon" />
                <span className="mode-option-title">Remote</span>
                <span className="mode-option-desc">Connect to a KanQual instance hosted somewhere else.</span>
              </button>
            </div>
          </div>
        ) : (
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            <label className="form-label">
              KanQual address
              <input
                className="form-input"
                value={remoteAddress}
                onChange={(event) => setRemoteAddress(event.target.value)}
                placeholder="host.example.org"
                autoFocus
              />
            </label>
            <p className="auth-hint">
              Remote PostgreSQL connection setup is not wired yet.
            </p>
            <div className="form-actions auth-actions--split">
              <button type="button" className="btn" onClick={() => setShowRemoteForm(false)}>
                Back
              </button>
              <button type="submit" className="btn btn--primary" disabled>
                Connect
              </button>
            </div>
          </form>
        )}
      </AuthSlideCard>
    </div>
  );
}
