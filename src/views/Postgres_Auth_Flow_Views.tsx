import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
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
import { useI18n } from "../i18n/provider";
import {
  getPostgresAccounts,
  savePostgresAccount as savePostgresAccountHistory,
} from "../lib/authHistory";
import { ComputerIcon, EyeIcon, EyeOffIcon, NetworkIcon } from "../components/AppIcons";
import { GettingStartedGuideCallout } from "../components/GettingStartedGuideCallout";
import { LoadingCard } from "../components/LoadingCard";
import { clearGettingStartedHandoff, readGettingStartedHandoff, updateGettingStartedHandoff } from "../lib/gettingStartedGuide";

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

function formatRecentLogin(iso: string, t: ReturnType<typeof useI18n>["t"]): string {
  const date = new Date(iso);
  const now = new Date();
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  const time = formatCurrentDateTime(date, { hour: "2-digit", minute: "2-digit" });
  if (days === 0) return t("auth.relativeTime.todayAt", { time });
  if (days === 1) return t("auth.relativeTime.yesterdayAt", { time });
  const shortDate = date.toLocaleDateString([], { month: "short", day: "numeric" });
  return t("auth.relativeTime.shortDateAt", { date: shortDate, time });
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

export type PostgresLaunchViewProps = {
  status: PostgresStatus | null;
  loading: boolean;
  onBootstrap: (superuserPassword: string) => Promise<void>;
  onInitialized?: () => Promise<void> | void;
  onRestored?: () => Promise<void> | void;
  onAuthenticated: (session: PostgresAuthSession) => void | Promise<void>;
  onFirstAccountCreated?: (session: PostgresAuthSession) => void | Promise<void>;
  onOpenPostgresProjects: () => void;
};

export function PostgresLaunchView({
  status,
  loading,
  onBootstrap,
  onInitialized,
  onRestored,
  onAuthenticated,
  onFirstAccountCreated,
  onOpenPostgresProjects,
}: PostgresLaunchViewProps) {
  const { t } = useI18n();
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
    submitting
    && !showingFirstAccountSetup
    && !bundledClusterInitialized
    && !!bundledPreflight;

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
      setError(t("auth.postgresLaunch.chooseAdminPasswordMin"));
      return;
    }
    if (initialAdminPassword !== confirmInitialAdminPassword) {
      setError(t("auth.postgresLaunch.adminPasswordsMismatch"));
      return;
    }

    setSubmitting(true);
    try {
      await initializeBundledPostgresCluster(initialAdminPassword);
      setShowFirstAccountSetup(false);
      setInitialAdminPassword("");
      setConfirmInitialAdminPassword("");
      const nextPreflight = await getBundledPostgresInitPreflight();
      setBundledPreflight(nextPreflight);
      setNotice("");
      await onInitialized?.();
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
      title: t("auth.postgresLaunch.chooseUpgradeBackupDialog"),
      filters: [
        {
          name: t("auth.postgresLaunch.upgradeBackupFilter"),
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
      setError(t("auth.postgresLaunch.chooseBackupFile"));
      return;
    }
    if (!restoreBackupPassword.trim()) {
      setError(t("auth.postgresLaunch.enterBackupPassword"));
      return;
    }
    if (restoreAdminPassword.length < 8) {
      setError(t("auth.postgresLaunch.chooseNewAdminPasswordMin"));
      return;
    }
    if (restoreAdminPassword !== confirmRestoreAdminPassword) {
      setError(t("auth.postgresLaunch.newAdminPasswordsMismatch"));
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
      setError(t("auth.postgresLaunch.enterAdminPasswordToFinish"));
      return;
    }

    setSubmitting(true);
    try {
      await onBootstrap(superuserPassword);
      setSuperuserPassword("");
      setNotice(t("auth.postgresLaunch.setupComplete"));
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
      setError(t("auth.postgresLaunch.enterUsername"));
      return;
    }
    if (/\s/.test(email)) {
      setError(t("auth.postgresLaunch.usernameNoSpaces"));
      return;
    }
    if (firstAccountPassword.length < 8) {
      setError(t("auth.postgresLaunch.choosePasswordMin"));
      return;
    }
    if (firstAccountPassword !== confirmFirstAccountPassword) {
      setError(t("auth.postgresLaunch.passwordsMismatch"));
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
            ? "incomplete-setup"
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
          <div className="auth-brand">{t("app.loadingCard.productName")}</div>
        </div>
        <div className="form">
          {restoreSuccess ? (
            <div className="form" role="status" aria-live="polite">
              <div className="auth-admin-notice">
                <strong>{t("auth.postgresLaunch.importCompleteTitle")}</strong>
                <span>{t("auth.postgresLaunch.importCompleteBody")}</span>
              </div>
              <div className="settings-diagnostics-grid settings-diagnostics-grid--compact">
                <div>
                  <span>{t("auth.postgresLaunch.backupVersion")}</span>
                  <strong>{restoreSuccess.backupKanqualVersion}</strong>
                </div>
                <div>
                  <span>{t("auth.postgresLaunch.projects")}</span>
                  <strong>{restoreSuccess.projectCount}</strong>
                </div>
                <div>
                  <span>{t("auth.postgresLaunch.files")}</span>
                  <strong>{restoreSuccess.storageFileCount}</strong>
                </div>
                <div>
                  <span>{t("auth.postgresLaunch.users")}</span>
                  <strong>{restoreSuccess.userCount}</strong>
                </div>
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn--primary" onClick={() => void finishRestoreSuccess()}>
                  {t("common.done")}
                </button>
              </div>
            </div>
          ) : showingFirstAccountSetup ? (
            <form onSubmit={handleFirstAccountSubmit} className="form">
              <div className="settings-warning settings-warning--danger">
                {t("auth.postgresLaunch.firstAccountBody")}
                <br />
                <br />
                {t("auth.postgresLaunch.firstAccountSeparate")}
              </div>
              <label className="form-label">
                {t("auth.postgresLaunch.username")}
                <input
                  className="form-input"
                  type="text"
                  value={firstAccountEmail}
                  onChange={(e) => setFirstAccountEmail(e.target.value)}
                  autoComplete="username"
                />
              </label>
              <label className="form-label">
                {t("auth.form.password")}
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
                    aria-label={firstAccountPasswordVisible ? t("common.hidePassword") : t("common.showPassword")}
                    aria-pressed={firstAccountPasswordVisible}
                    onClick={() => setFirstAccountPasswordVisible((current) => !current)}
                  >
                    {firstAccountPasswordVisible ? <EyeOffIcon className="password-visibility-icon" /> : <EyeIcon className="password-visibility-icon" />}
                  </button>
                </div>
                <p className="password-requirement-note">{t("auth.postgresLaunch.minimumCharacters")}</p>
              </label>
              <label className="form-label">
                {t("auth.postgresLaunch.confirmPassword")}
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
                    aria-label={confirmFirstAccountPasswordVisible ? t("common.hidePassword") : t("common.showPassword")}
                    aria-pressed={confirmFirstAccountPasswordVisible}
                    onClick={() => setConfirmFirstAccountPasswordVisible((current) => !current)}
                  >
                    {confirmFirstAccountPasswordVisible ? <EyeOffIcon className="password-visibility-icon" /> : <EyeIcon className="password-visibility-icon" />}
                  </button>
                </div>
              </label>
              {firstAccountPasswordMismatch ? (
                <p className="settings-warning settings-warning--danger" style={{ margin: 0 }}>
                  {t("auth.postgresLaunch.passwordEntriesDoNotMatch")}
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
                  {submitting ? t("common.creating") : t("auth.form.createAccount")}
                </button>
              </div>
            </form>
          ) : !bundledPreflightLoading && bundledPreflight && !bundledClusterInitialized && (
            <>
              <div className="segmented-control modal-segmented-control" role="group" aria-label={t("auth.postgresLaunch.setupModeAria")}>
                {[
                  { value: "setup", label: t("auth.postgresLaunch.newSetup") },
                  { value: "restore", label: t("auth.postgresLaunch.restoreSetup") },
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
                    {t("auth.postgresLaunch.restoreIntro")}
                  </div>
                  {bundledPreflight.issues.length ? (
                    <div className="settings-warning">
                      {bundledPreflight.issues.join(" ")}
                    </div>
                  ) : null}
                  <label className="form-label">
                    {t("auth.postgresLaunch.backupFile")}
                    <div className="form-inline-action-row">
                      <input
                        className="form-input"
                        type="text"
                        value={restoreBackupPath}
                        readOnly
                        placeholder={t("auth.postgresLaunch.noBackupSelected")}
                      />
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void chooseRestoreBackupFile()}
                        disabled={submitting}
                      >
                        {t("auth.postgresLaunch.choose")}
                      </button>
                    </div>
                  </label>
                  <label className="form-label">
                    {t("auth.postgresLaunch.backupPassword")}
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
                        aria-label={restoreBackupPasswordVisible ? t("common.hidePassword") : t("common.showPassword")}
                        aria-pressed={restoreBackupPasswordVisible}
                        onClick={() => setRestoreBackupPasswordVisible((current) => !current)}
                      >
                        {restoreBackupPasswordVisible ? <EyeOffIcon className="password-visibility-icon" /> : <EyeIcon className="password-visibility-icon" />}
                      </button>
                    </div>
                  </label>
                  <label className="form-label">
                    {t("auth.postgresLaunch.newAdminPassword")}
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
                        aria-label={restoreAdminPasswordVisible ? t("common.hidePassword") : t("common.showPassword")}
                        aria-pressed={restoreAdminPasswordVisible}
                        onClick={() => setRestoreAdminPasswordVisible((current) => !current)}
                      >
                        {restoreAdminPasswordVisible ? <EyeOffIcon className="password-visibility-icon" /> : <EyeIcon className="password-visibility-icon" />}
                      </button>
                    </div>
                    <p className="password-requirement-note">{t("auth.postgresLaunch.minimumCharacters")}</p>
                  </label>
                  <label className="form-label">
                    {t("auth.postgresLaunch.confirmPassword")}
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
                        aria-label={confirmRestoreAdminPasswordVisible ? t("common.hidePassword") : t("common.showPassword")}
                        aria-pressed={confirmRestoreAdminPasswordVisible}
                        onClick={() => setConfirmRestoreAdminPasswordVisible((current) => !current)}
                      >
                        {confirmRestoreAdminPasswordVisible ? <EyeOffIcon className="password-visibility-icon" /> : <EyeIcon className="password-visibility-icon" />}
                      </button>
                    </div>
                  </label>
                  {restoreAdminPasswordMismatch ? (
                    <p className="settings-warning settings-warning--danger" style={{ margin: 0 }}>
                      {t("auth.postgresLaunch.passwordEntriesDoNotMatch")}
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
                      {submitting ? t("common.restoring") : t("common.restore")}
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleInitializeBundledPostgres} className="form">
                  <div className="settings-warning settings-warning--danger">
                    {t("auth.postgresLaunch.firstStartIntro")}
                  </div>
                  {bundledPreflight.issues.length ? (
                    <div className="settings-warning">
                      {bundledPreflight.issues.join(" ")}
                    </div>
                  ) : null}
                  <label className="form-label">
                    {t("auth.postgresLaunch.adminPassword")}
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
                        aria-label={initialAdminPasswordVisible ? t("common.hidePassword") : t("common.showPassword")}
                        aria-pressed={initialAdminPasswordVisible}
                        onClick={() => setInitialAdminPasswordVisible((current) => !current)}
                      >
                        {initialAdminPasswordVisible ? <EyeOffIcon className="password-visibility-icon" /> : <EyeIcon className="password-visibility-icon" />}
                      </button>
                    </div>
                    <p className="password-requirement-note">{t("auth.postgresLaunch.minimumCharacters")}</p>
                  </label>
                  <label className="form-label">
                    {t("auth.postgresLaunch.confirmPassword")}
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
                        aria-label={confirmInitialAdminPasswordVisible ? t("common.hidePassword") : t("common.showPassword")}
                        aria-pressed={confirmInitialAdminPasswordVisible}
                        onClick={() => setConfirmInitialAdminPasswordVisible((current) => !current)}
                      >
                        {confirmInitialAdminPasswordVisible ? <EyeOffIcon className="password-visibility-icon" /> : <EyeIcon className="password-visibility-icon" />}
                      </button>
                    </div>
                  </label>
                  {initialAdminPasswordMismatch ? (
                    <p className="settings-warning settings-warning--danger" style={{ margin: 0 }}>
                      {t("auth.postgresLaunch.passwordEntriesDoNotMatch")}
                    </p>
                  ) : null}
                  <div className="form-actions">
                    <button
                      type="submit"
                      className="btn btn--primary"
                      disabled={loading || submitting || !bundledPreflight.canInitialize || initialAdminPasswordMismatch}
                    >
                      {submitting ? t("common.submitting") : t("common.submit")}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}

          {!showingFirstAccountSetup && bundledClusterInitialized && !bootstrapApplied && (
            <form onSubmit={handleBootstrapSubmit} className="form">
              <div className="settings-warning settings-warning--danger">
                {t("auth.postgresLaunch.resumeSetupIntro")}
              </div>
              <label className="form-label">
                {t("auth.postgresLaunch.adminPassword")}
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
                    aria-label={superuserPasswordVisible ? t("common.hidePassword") : t("common.showPassword")}
                    aria-pressed={superuserPasswordVisible}
                    onClick={() => setSuperuserPasswordVisible((current) => !current)}
                  >
                    {superuserPasswordVisible ? <EyeOffIcon className="password-visibility-icon" /> : <EyeIcon className="password-visibility-icon" />}
                  </button>
                </div>
              </label>
              <div className="form-actions">
                <button type="submit" className="btn btn--primary" disabled={loading || submitting}>
                  {submitting ? t("auth.postgresLaunch.finishing") : t("auth.postgresLaunch.finishSetup")}
                </button>
              </div>
            </form>
          )}

          {!showingFirstAccountSetup && bootstrapApplied && !adminHandoffCompleted && (
            <>
              <div className="settings-warning settings-warning--danger">
                {t("auth.postgresLaunch.incompleteSetupIntro")}
              </div>
            </>
          )}

          {!showingFirstAccountSetup && databaseReady && (
            <>
              <div className="settings-warning">
                <strong>{t("auth.postgresLaunch.readyTitle")}</strong>
                <br />
                {t("auth.postgresLaunch.readyBody")}
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn--primary" onClick={onOpenPostgresProjects}>
                  {t("auth.postgresLaunch.openProjects")}
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
  const { t } = useI18n();
  const [gettingStartedHandoff, setGettingStartedHandoff] = useState(() => readGettingStartedHandoff());
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

  useEffect(() => {
    if (!gettingStartedHandoff || gettingStartedHandoff.step !== "loginAsUser") return;
    if (!gettingStartedHandoff.temporaryUsername) return;
    setEmail((current) => current || gettingStartedHandoff.temporaryUsername);
  }, [gettingStartedHandoff]);

  function exitGettingStartedHandoff() {
    clearGettingStartedHandoff();
    setGettingStartedHandoff(null);
  }

  async function handleFirstAccountSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const email = firstAccountEmail.trim().toLowerCase();
    if (!email) {
      setError(t("auth.postgresLaunch.enterUsername"));
      return;
    }
    if (/\s/.test(email)) {
      setError(t("auth.postgresLaunch.usernameNoSpaces"));
      return;
    }
    if (password.length < 8) {
      setError(t("auth.postgresLaunch.choosePasswordMin"));
      return;
    }
    if (password !== confirmFirstAccountPassword) {
      setError(t("auth.postgresLaunch.passwordsMismatch"));
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
        setError(t("auth.postgresLaunch.enterAdminPassword"));
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
        setError(t("auth.postgresLaunch.enterYourUsername"));
        return;
      }
      if (/\s/.test(trimmedEmail)) {
        setError(t("auth.postgresLaunch.usernameNoSpaces"));
        return;
      }
      setEmail(trimmedEmail);
      setPassword("");
      setPasswordVisible(false);
      setSignInStep("password");
      return;
    }

    if (!trimmedEmail) {
      setError(t("auth.postgresLaunch.enterYourUsername"));
      return;
    }
    if (/\s/.test(trimmedEmail)) {
      setError(t("auth.postgresLaunch.usernameNoSpaces"));
      return;
    }
    if (!password) {
      setError(t("auth.postgresLaunch.enterPassword"));
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
      if (
        gettingStartedHandoff
        && (gettingStartedHandoff.userId === session.user.id || gettingStartedHandoff.temporaryUsername === session.user.username)
      ) {
        const nextStep = session.user.mustChangePassword ? "changePassword" : "chooseLocalWorkspace";
        setGettingStartedHandoff(updateGettingStartedHandoff({ step: nextStep, currentActor: "projectUser" }));
      }
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
            <div className="auth-brand">{t("app.loadingCard.productName")}</div>
          </div>
          <form onSubmit={handleFirstAccountSubmit} className="form">
            <div className="settings-warning settings-warning--danger">
              {t("auth.postgresLaunch.firstAccountBody")}
              <br />
              <br />
              {t("auth.postgresLaunch.firstAccountSeparate")}
            </div>
            <label className="form-label">
              {t("auth.postgresLaunch.username")}
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
              {t("auth.form.password")}
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
                  aria-label={passwordVisible ? t("common.hidePassword") : t("common.showPassword")}
                  aria-pressed={passwordVisible}
                  onClick={() => setPasswordVisible((current) => !current)}
                >
                  {passwordVisible ? <EyeOffIcon className="password-visibility-icon" /> : <EyeIcon className="password-visibility-icon" />}
                </button>
              </div>
              <p className="password-requirement-note">{t("auth.postgresLaunch.minimumCharacters")}</p>
            </label>
            <label className="form-label">
              {t("auth.postgresLaunch.confirmPassword")}
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
                  aria-label={confirmFirstAccountPasswordVisible ? t("common.hidePassword") : t("common.showPassword")}
                  aria-pressed={confirmFirstAccountPasswordVisible}
                  onClick={() => setConfirmFirstAccountPasswordVisible((current) => !current)}
                >
                  {confirmFirstAccountPasswordVisible ? <EyeOffIcon className="password-visibility-icon" /> : <EyeIcon className="password-visibility-icon" />}
                </button>
              </div>
            </label>
            {firstAccountPasswordMismatch ? (
              <p className="settings-warning settings-warning--danger" style={{ margin: 0 }}>
                {t("auth.postgresLaunch.passwordEntriesDoNotMatch")}
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
                {submitting ? t("common.creating") : t("auth.form.createAccount")}
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
            <div className="auth-brand">{t("app.loadingCard.productName")}</div>
          </div>
          <form onSubmit={handleSubmit} className="form">
            <div className="auth-admin-notice">
              <strong>{t("auth.postgresSignIn.adminTitle")}</strong>
              <span>
                {t("auth.postgresSignIn.adminBody")}
              </span>
            </div>

            <label className="form-label">
              {t("auth.postgresSignIn.adminPassword")}
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
                  aria-label={passwordVisible ? t("common.hidePassword") : t("common.showPassword")}
                  aria-pressed={passwordVisible}
                  onClick={() => setPasswordVisible((current) => !current)}
                >
                  {passwordVisible ? <EyeOffIcon className="password-visibility-icon" /> : <EyeIcon className="password-visibility-icon" />}
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
                {t("common.back")}
              </button>
              <button type="submit" className="btn btn--primary" disabled={submitting}>
                {submitting ? t("auth.form.pleaseWait") : t("auth.form.signIn")}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className={`auth-screen${gettingStartedHandoff ? " auth-screen--getting-started-login" : ""}`}>
      {gettingStartedHandoff ? <div className="getting-started-spotlight-overlay" aria-hidden="true" /> : null}
      <div
        className={`auth-card${gettingStartedHandoff ? " getting-started-spotlight-target" : ""}`}
        style={{ maxWidth: 720 }}
      >
        <div className="auth-brand-row">
          <img src="/logo.png" alt="" className="auth-brand-row-logo" />
          <div className="auth-brand">{t("app.loadingCard.productName")}</div>
        </div>
        <form onSubmit={handleSubmit} className="form">
          {gettingStartedHandoff ? (
            <>
              <GettingStartedGuideCallout title={t("app.gettingStarted.continueTitle")} onDismiss={exitGettingStartedHandoff}>
                {signInStep === "username" ? (
                  <p>{t("app.gettingStarted.signInUsernameBody", { username: gettingStartedHandoff.temporaryUsername || t("app.gettingStarted.newProjectUser") })}</p>
                ) : (
                  <p>{t("app.gettingStarted.signInPasswordBody", { username: gettingStartedHandoff.temporaryUsername || t("app.gettingStarted.newProjectUser") })}</p>
                )}
              </GettingStartedGuideCallout>
            </>
          ) : null}

          {signInStep === "username" && recentAccounts.length > 0 ? (
            <div className="auth-recent-accounts">
              <div className="auth-recent-accounts-title">{t("auth.postgresSignIn.recentAccounts")}</div>
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
                    <div className="account-login-time">{formatRecentLogin(account.lastLogin, t)}</div>
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
              {t("auth.postgresSignIn.username")}
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
              {t("auth.postgresSignIn.password")}
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
                  aria-label={passwordVisible ? t("common.hidePassword") : t("common.showPassword")}
                  aria-pressed={passwordVisible}
                  onClick={() => setPasswordVisible((current) => !current)}
                >
                  {passwordVisible ? <EyeOffIcon className="password-visibility-icon" /> : <EyeIcon className="password-visibility-icon" />}
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
                {t("common.back")}
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
                {t("auth.postgresSignIn.administrator")}
              </button>
            )}
            <button type="submit" className="btn btn--primary" disabled={submitting}>
              {submitting ? t("auth.form.pleaseWait") : signInStep === "username" ? t("common.next") : t("auth.form.signIn")}
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
  const { t } = useI18n();
  const [showRemoteForm, setShowRemoteForm] = useState(false);
  const [remoteAddress, setRemoteAddress] = useState("");
  const [gettingStartedHandoff, setGettingStartedHandoff] = useState(() => readGettingStartedHandoff());

  function exitGettingStartedHandoff() {
    clearGettingStartedHandoff();
    setGettingStartedHandoff(null);
  }

  function handleUseLocal() {
    if (gettingStartedHandoff) {
      setGettingStartedHandoff(updateGettingStartedHandoff({ step: "chooseProject", currentActor: "projectUser" }));
    }
    onUseLocal();
  }

  const guideChoosingLocal = !!gettingStartedHandoff && gettingStartedHandoff.step === "chooseLocalWorkspace";

  return (
    <div className={`auth-screen${guideChoosingLocal && !showRemoteForm ? " auth-screen--getting-started-spotlight" : ""}`}>
      <AuthSlideCard stage={showRemoteForm ? "remote-connection" : "workspace-mode"}>
        <div className="auth-brand-row">
          <img src="/logo.png" alt="" className="auth-brand-row-logo" />
          <div className="auth-brand">{t("app.loadingCard.productName")}</div>
        </div>
        {!showRemoteForm ? (
          <div className="form">
            {gettingStartedHandoff ? (
              <GettingStartedGuideCallout title={t("app.gettingStarted.continueTitle")} onDismiss={exitGettingStartedHandoff}>
                <p>{t("app.gettingStarted.chooseLocalBody")}</p>
              </GettingStartedGuideCallout>
            ) : null}
            <div className="mode-options mode-options--auth-card">
              <button
                type="button"
                className={`mode-option${guideChoosingLocal ? " getting-started-spotlight-target" : ""}`}
                onClick={handleUseLocal}
              >
                <ComputerIcon className="mode-option-icon" />
                <span className="mode-option-title">{t("auth.workspaceMode.localTitle")}</span>
                <span className="mode-option-desc">{t("auth.workspaceMode.localDescription")}</span>
              </button>
              <button type="button" className="mode-option" onClick={() => setShowRemoteForm(true)}>
                <NetworkIcon className="mode-option-icon" />
                <span className="mode-option-title">{t("auth.workspaceMode.remoteTitle")}</span>
                <span className="mode-option-desc">{t("auth.workspaceMode.remoteDescription")}</span>
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
              {t("auth.workspaceMode.productAddress")}
              <input
                className="form-input"
                value={remoteAddress}
                onChange={(event) => setRemoteAddress(event.target.value)}
                placeholder={t("auth.workspaceMode.remotePlaceholder")}
                autoFocus
              />
            </label>
            <p className="auth-hint">
              {t("auth.workspaceMode.remoteNotWired")}
            </p>
            <div className="form-actions auth-actions--split">
              <button type="button" className="btn" onClick={() => setShowRemoteForm(false)}>
                {t("common.back")}
              </button>
              <button type="submit" className="btn btn--primary" disabled>
                {t("auth.workspaceMode.connect")}
              </button>
            </div>
          </form>
        )}
      </AuthSlideCard>
    </div>
  );
}
