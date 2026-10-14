import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n/provider";
import { RestoreSummary } from "./RestoreSummary";

type Preview = { fingerprint: string; version: string; createdAtMs: number; projects: string[]; fileCount: number; userCount: number | null };
type RestoreState = { phase: "prepared" | "moving" | "restoring" | "complete" | "recovered"; preview: Preview; recoveryBackup: string };
type Draft = { path: string; password: string; preview: Preview };
const RestoreContext = createContext<((draft: Draft) => void) | null>(null);

// Share only in-flight reads; subsequent visits must see the current journal.
let pendingStatus: Promise<RestoreState | null> | undefined;
function restoreStatus(): Promise<RestoreState | null> {
  if (!pendingStatus) {
    pendingStatus = invoke<RestoreState | null>("installation_restore_status_command")
      .finally(() => { pendingStatus = undefined; });
  }
  return pendingStatus;
}

function BackupPreview({ preview }: { preview: Preview }) {
  const { formatDateTime } = useI18n();
  return <div className="installation-restore-preview form">
    <RestoreSummary version={preview.version} projects={preview.projects.length} files={preview.fileCount} users={preview.userCount} />
    {preview.createdAtMs > 0 && <p>{formatDateTime(preview.createdAtMs)}</p>}
    <ul>{preview.projects.map((name, index) => <li key={index}>{name}</li>)}</ul>
  </div>;
}

/** The settings modal only selects and validates the incoming backup. */
export function InstallationRestoreCard() {
  const { t } = useI18n();
  const start = useContext(RestoreContext);
  const [path, setPath] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const working = useRef(false);
  async function action(run: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError("");
    try { await run(); } catch (e) { setError(String(e)); } finally { working.current = false; setBusy(false); }
  }
  return <section className="app-settings-modal-section">
    <div className="app-settings-modal-section-header app-settings-modal-section-header--default"><h3>{t("installationRestore.title")}</h3></div>
    <div className="app-settings-modal-section-body">
      <p>{t("installationRestore.description")}</p>
      <p>{t("installationRestore.warning")}</p>
      <button className="btn" disabled={busy} onClick={() => void action(async () => {
        const selected = await open({ multiple: false, filters: [{ name: t("installationRestore.title"), extensions: ["kanqual-upgrade-backup"] }] });
        if (typeof selected === "string") { setPath(selected); setPassword(""); }
      })}>{t("installationRestore.choose")}</button>
      <p className="installation-restore-path">{path}</p>
      <label className="settings-field"><span>{t("installationRestore.backupPassword")}</span><input className="form-input" type="password" autoComplete="off" disabled={busy} value={password} onChange={e => setPassword(e.target.value)} /></label>
      <button className="btn" disabled={busy || !path || !password || !start} onClick={() => void action(async () => {
        const preview = await invoke<Preview>("preview_installation_restore_command", { backupPath: path, backupPassword: password });
        start?.({ path, password, preview });
      })}>{t("installationRestore.validate")}</button>
      {busy && <p role="status">{t("installationRestore.validating")}</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
    </div>
  </section>;
}

/** Own the wizard outside settings and block normal screens during recovery. */
export function InstallationRestoreGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [state, setState] = useState<RestoreState | null | undefined>(undefined);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [reviewBackup, setReviewBackup] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [password, setPassword] = useState("");
  const [hasValidatedPassword, setHasValidatedPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const working = useRef(false);
  const [statusError, setStatusError] = useState("");
  async function refresh() { setState(await restoreStatus()); setStatusError(""); }
  useEffect(() => {
    let cancelled = false;
    void restoreStatus().then(result => {
      if (!cancelled) { setState(result); setStatusError(""); }
    }).catch(e => { if (!cancelled) setStatusError(String(e)); });
    return () => { cancelled = true; };
  }, []);
  async function action(run: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError("");
    try { await run(); } catch (e) {
      setError(String(e));
      try { await refresh(); } catch (recoveryError) { setStatusError(String(recoveryError)); }
    } finally { working.current = false; setBusy(false); }
  }
  async function prepare(skipRecoveryBackup: boolean) {
    if (!draft) return;
    const result = await invoke<RestoreState>("prepare_installation_restore_command", {
      backupPath: draft.path, backupPassword: draft.password,
      adminPassword: skipRecoveryBackup ? null : adminPassword, skipRecoveryBackup,
      fingerprint: draft.preview.fingerprint, confirmation: "RESTORE",
    });
    setPassword(draft.password); setHasValidatedPassword(true);
    setState(result); setReviewBackup(true); setDraft(null); setAdminPassword("");
  }
  const settingAdminPassword = !draft && state?.phase === "prepared" && !reviewBackup;
  if (state === null && !draft) return <RestoreContext.Provider value={next => { setError(""); setDraft(next); }}>{children}</RestoreContext.Provider>;
  return <div className="auth-screen"><div className="auth-card installation-restore-screen">
    <div className="auth-brand-row">
      <img src="/logo.png" alt="" className="auth-brand-row-logo" />
      <div className="auth-brand">{t("app.loadingCard.productName")}</div>
    </div>
    <div className="form">
    <h2>{t(draft ? "installationRestore.suggestBackup" : settingAdminPassword ? "installationRestore.setAdminPasswordTitle" : "installationRestore.title")}</h2>
    {draft ? <>
      <div className="settings-warning settings-warning--danger">{t("installationRestore.backupRecommendation")}</div>
      <p>{t("installationRestore.warning")}</p>
      <label className="form-label">{t("installationRestore.currentPassword")}<input className="form-input" type="password" autoComplete="current-password" disabled={busy} value={adminPassword} onChange={e => setAdminPassword(e.target.value)} /></label>
      <p>{t("installationRestore.recoveryPassword")}</p>
      <div className="form-actions">
        <button className="btn" disabled={busy} onClick={() => { setDraft(null); setAdminPassword(""); setError(""); }}>{t("common.cancel")}</button>
        <button className="btn" disabled={busy} onClick={() => void action(() => prepare(true))}>{t("installationRestore.skipBackup")}</button>
        <button className="btn btn--primary" disabled={busy || !adminPassword} onClick={() => void action(() => prepare(false))}>{t("installationRestore.backupContinue")}</button>
      </div>
    </> : state === undefined ? <>
      <p role="status">{t("installationRestore.checking")}</p>
      {(error || statusError) && <button className="btn" disabled={busy} onClick={() => void action(refresh)}>{t("installationRestore.retry")}</button>}
    </> : state ? <>
      {state.phase === "complete" && <div className="auth-admin-notice"><strong>{t("auth.postgresLaunch.importCompleteTitle")}</strong><span>{t("auth.postgresLaunch.importCompleteBody")}</span></div>}
      {!settingAdminPassword && <>
      <BackupPreview preview={state.preview} />
      {state.recoveryBackup ? <p className="installation-restore-path">{t("installationRestore.recoveryLocation")} {state.recoveryBackup}</p> : <p>{t("installationRestore.noRecoveryBackup")}</p>}
      </>}
      {state.phase === "prepared" ? reviewBackup ? <>
        <p>{t("installationRestore.review")}</p>
        <div className="form-actions">
          <button className="btn" disabled={busy} onClick={() => void action(() => invoke("finish_installation_restore_command", { cancel: true }))}>{t("common.cancel")}</button>
          <button className="btn btn--primary" disabled={busy} onClick={() => { setReviewBackup(false); setError(""); }}>{t("installationRestore.continue")}</button>
        </div>
      </> : <>
        <div className="settings-warning settings-warning--danger">{t("installationRestore.warning")}</div>
        {!hasValidatedPassword && <>
        <p>{t("installationRestore.resume")}</p>
        <label className="form-label">{t("installationRestore.backupPassword")}<input className="form-input" type="password" autoComplete="off" disabled={busy} value={password} onChange={e => setPassword(e.target.value)} /></label>
        </>}
        <label className="form-label">{t("installationRestore.newPassword")}<input className="form-input" type="password" autoComplete="new-password" disabled={busy} value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label>
        <label className="form-label">{t("installationRestore.confirmPassword")}<input className="form-input" type="password" autoComplete="new-password" disabled={busy} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></label>
        {confirmPassword && newPassword !== confirmPassword && <p className="settings-warning settings-warning--danger">{t("auth.postgresLaunch.passwordEntriesDoNotMatch")}</p>}
        <div className="form-actions">
          <button className="btn" disabled={busy} onClick={() => void action(() => invoke("finish_installation_restore_command", { cancel: true }))}>{t("common.cancel")}</button>
          <button className="btn btn--primary" disabled={busy || !password || newPassword.trim().length < 8 || newPassword !== confirmPassword} onClick={() => void action(async () => {
            setState(await invoke<RestoreState>("execute_installation_restore_command", { backupPassword: password, newAdminPassword: newPassword }));
            setPassword(""); setHasValidatedPassword(false); setNewPassword(""); setConfirmPassword("");
          })}>{t("installationRestore.continue")}</button>
        </div>
      </> : <>
        <p>{state.phase === "complete" ? t("installationRestore.complete") : t("installationRestore.recovered")}</p>
        <button className="btn btn--primary" disabled={busy} onClick={() => void action(() => invoke("finish_installation_restore_command", { cancel: false }))}>{t("installationRestore.restart")}</button>
      </>}
    </> : null}
    {statusError && <p className="auth-error" role="alert">{statusError}</p>}
    {busy && <p role="status">{t(draft ? "installationRestore.preparing" : "installationRestore.working")}</p>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    </div>
  </div></div>;
}
