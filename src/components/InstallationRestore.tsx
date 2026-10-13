import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useI18n } from "../i18n/provider";

type Preview = { fingerprint: string; version: string; createdAtMs: number; projects: string[]; fileCount: number; userCount: number | null };
type RestoreState = { phase: "prepared" | "moving" | "restoring" | "complete" | "recovered"; preview: Preview; recoveryBackup: string };

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
  const { t, formatDateTime, formatNumber } = useI18n();
  return <div className="installation-restore-preview">
    <p>{t("installationRestore.preview", { version: preview.version, projects: formatNumber(preview.projects.length), files: formatNumber(preview.fileCount), users: preview.userCount === null ? t("installationRestore.unknownUsers") : formatNumber(preview.userCount) })}</p>
    {preview.createdAtMs > 0 && <p>{formatDateTime(preview.createdAtMs)}</p>}
    <ul>{preview.projects.map((name, index) => <li key={index}>{name}</li>)}</ul>
  </div>;
}

export function InstallationRestoreCard() {
  const { t } = useI18n();
  const [path, setPath] = useState("");
  const [password, setPassword] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [prepared, setPrepared] = useState<RestoreState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [statusAttempt, setStatusAttempt] = useState(0);
  const [progress, setProgress] = useState("");
  const working = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void restoreStatus().then(result => {
      if (!cancelled) { setPrepared(result); setStatusError(""); }
    }).catch(e => { if (!cancelled) setStatusError(String(e)); });
    return () => { cancelled = true; };
  }, [statusAttempt]);
  async function action(label: string, run: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(""); setProgress(label);
    try { await run(); } catch (e) { setError(String(e)); } finally { working.current = false; setBusy(false); setProgress(""); }
  }
  return <section className="app-settings-modal-section">
    <div className="app-settings-modal-section-header app-settings-modal-section-header--default"><h3>{t("installationRestore.title")}</h3></div>
    <div className="app-settings-modal-section-body">
      <p>{t("installationRestore.description")}</p>
      <p>{t("installationRestore.warning")}</p>
      {prepared ? <>
        <p>{t("installationRestore.prepared")}</p>
        <p className="installation-restore-path">{prepared.recoveryBackup}</p>
        <button className="btn btn--primary" disabled={busy} onClick={() => void action(t("installationRestore.restarting"), () => invoke("finish_installation_restore_command", { cancel: false }))}>{t("installationRestore.restart")}</button>
        <button className="btn" disabled={busy} onClick={() => void action(t("installationRestore.restarting"), () => invoke("finish_installation_restore_command", { cancel: true }))}>{t("installationRestore.cancel")}</button>
      </> : <>
        <button className="btn" disabled={busy} onClick={() => void action("", async () => {
          const selected = await open({ multiple: false, filters: [{ name: t("installationRestore.title"), extensions: ["kanqual-upgrade-backup"] }] });
          if (typeof selected === "string") { setPath(selected); setPreview(null); setConfirmation(""); setPassword(""); }
        })}>{t("installationRestore.choose")}</button>
        <p className="installation-restore-path">{path}</p>
        <label className="settings-field"><span>{t("installationRestore.backupPassword")}</span><input className="form-input" type="password" autoComplete="off" disabled={busy} value={password} onChange={e => { setPassword(e.target.value); setPreview(null); setConfirmation(""); }} /></label>
        <button className="btn" disabled={busy || !path || !password} onClick={() => void action(t("installationRestore.validating"), async () => {
          setPreview(null);
          setPreview(await invoke<Preview>("preview_installation_restore_command", { backupPath: path, backupPassword: password }));
        })}>{t("installationRestore.validate")}</button>
        {preview && <>
          <BackupPreview preview={preview} />
          <label className="settings-field"><span>{t("installationRestore.currentPassword")}</span><input className="form-input" type="password" autoComplete="current-password" disabled={busy} value={adminPassword} onChange={e => setAdminPassword(e.target.value)} /></label>
          <p>{t("installationRestore.recoveryPassword")}</p>
          <label className="settings-field"><span>{t("installationRestore.confirmation")}</span><input className="form-input" disabled={busy} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
          <button className="btn btn--danger" disabled={busy || confirmation !== "RESTORE" || !adminPassword} onClick={() => void action(t("installationRestore.preparing"), async () => {
            const result = await invoke<RestoreState>("prepare_installation_restore_command", { backupPath: path, backupPassword: password, adminPassword, fingerprint: preview.fingerprint, confirmation });
            setPrepared(result); setPassword(""); setAdminPassword("");
          })}>{t("installationRestore.prepare")}</button>
        </>}
      </>}
      {statusError && <>
        <p className="auth-error" role="alert">{statusError}</p>
        <button className="btn" disabled={busy} onClick={() => setStatusAttempt(attempt => attempt + 1)}>{t("installationRestore.retry")}</button>
      </>}
      {progress && <p role="status">{progress}</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
    </div>
  </section>;
}

/** Do not mount normal application screens until recovery status is known. */
export function InstallationRestoreGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [state, setState] = useState<RestoreState | null | undefined>(undefined);
  const [password, setPassword] = useState("");
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
      try { await refresh(); } catch (recoveryError) { setError(`${String(e)}\n${String(recoveryError)}`); }
    } finally { working.current = false; setBusy(false); }
  }
  if (state === null) return <>{children}</>;
  return <div className="auth-screen"><div className="auth-card installation-restore-screen">
    <h2>{t("installationRestore.title")}</h2>
    {state === undefined ? <>
      <p role="status">{t("installationRestore.checking")}</p>
      {(error || statusError) && <button className="btn" disabled={busy} onClick={() => void action(refresh)}>{t("installationRestore.retry")}</button>}
    </> : <>
      <BackupPreview preview={state.preview} />
      <p className="installation-restore-path">{t("installationRestore.recoveryLocation")} {state.recoveryBackup}</p>
      {state.phase === "prepared" ? <>
        <p>{t("installationRestore.warning")}</p>
        <p>{t("installationRestore.resume")}</p>
        <label className="settings-field"><span>{t("installationRestore.backupPassword")}</span><input className="form-input" type="password" autoComplete="off" disabled={busy} value={password} onChange={e => setPassword(e.target.value)} /></label>
        <label className="settings-field"><span>{t("installationRestore.newPassword")}</span><input className="form-input" type="password" autoComplete="new-password" disabled={busy} value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label>
        <label className="settings-field"><span>{t("installationRestore.confirmPassword")}</span><input className="form-input" type="password" autoComplete="new-password" disabled={busy} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /></label>
        <button className="btn btn--danger" disabled={busy || !password || newPassword.trim().length < 8 || newPassword !== confirmPassword} onClick={() => void action(async () => {
          setState(await invoke<RestoreState>("execute_installation_restore_command", { backupPassword: password, newAdminPassword: newPassword }));
          setPassword(""); setNewPassword(""); setConfirmPassword("");
        })}>{t("installationRestore.replace")}</button>
        <button className="btn" disabled={busy} onClick={() => void action(() => invoke("finish_installation_restore_command", { cancel: true }))}>{t("installationRestore.cancel")}</button>
      </> : <>
        <p>{state.phase === "complete" ? t("installationRestore.complete") : t("installationRestore.recovered")}</p>
        <button className="btn btn--primary" disabled={busy} onClick={() => void action(() => invoke("finish_installation_restore_command", { cancel: false }))}>{t("installationRestore.restart")}</button>
      </>}
    </>}
    {statusError && <p className="auth-error" role="alert">{statusError}</p>}
    {busy && <p role="status">{t("installationRestore.working")}</p>}
    {error && <p className="auth-error" role="alert">{error}</p>}
  </div></div>;
}
