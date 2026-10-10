import { useEffect, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { PostgresProject } from "../lib/postgres";
import { useI18n } from "../i18n/provider";
import { SettingsModal } from "./SettingsModal";

type Preview = { token: string | null; requiresPassword: boolean; name: string; counts: Record<string, number>; warnings: string[] };
type Progress = { id: string; phase: "reading" | "extracting" | "verifying" | "decrypting" | "importing" | "copying"; completed: number; total: number };

export function ProjectImportModal({ onClose, onImported }: {
  onClose: () => void;
  onImported: (project: PostgresProject) => void;
}) {
  const { t } = useI18n();
  const [path, setPath] = useState("");
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState("");
  const activeId = useRef<string | null>(null);
  const mounted = useRef(true);
  const cancelRequested = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const listener = listen<Progress>("project-import-progress", ({ payload }) => {
      if (mounted.current && payload.id === activeId.current) setProgress(payload);
    });
    return () => {
      mounted.current = false;
      void listener.then((unlisten) => unlisten()).catch(() => {});
      if (activeId.current) void invoke("cancel_project_import_command", { id: activeId.current }).catch(() => {});
    };
  }, []);

  function failed(failure: unknown) {
    if (!mounted.current) return;
    setPreview(null);
    setError(cancelRequested.current ? t("projectImport.cancelled") : failure instanceof Error ? failure.message : String(failure));
  }
  async function release() {
    if (activeId.current) {
      await invoke("cancel_project_import_command", { id: activeId.current });
      activeId.current = null;
    }
  }
  async function prepare(filePath: string, backupPassword?: string) {
    const id = crypto.randomUUID();
    activeId.current = id;
    const result = await invoke<Preview>("prepare_project_import_command", { request: { id, path: filePath, password: backupPassword ?? null } });
    if (!mounted.current) { await invoke("cancel_project_import_command", { id }); return; }
    if (cancelRequested.current) {
      await release(); setError(t("projectImport.cancelled")); return;
    }
    setLocked(result.requiresPassword);
    if (result.token) {
      setPreview(result);
      setName(result.name || t("projectImport.defaultName"));
      setPassword("");
    } else { activeId.current = null; }
  }
  function start() { setBusy(true); setCancelling(false); cancelRequested.current = false; setError(""); setProgress(null); }
  function finish() { if (mounted.current) { setBusy(false); setCancelling(false); } }
  async function chooseFile() {
    start();
    try {
      const filePath = await open({ multiple: false, directory: false, filters: [{ name: t("projectImport.fileTypes"), extensions: ["json", "kqbe", "qdpx"] }] });
      if (!filePath) return;
      await release();
      setPreview(null); setPassword(""); setName(""); setPath(filePath); setLocked(false);
      if (filePath.toLowerCase().endsWith(".kqbe")) setLocked(true);
      else await prepare(filePath);
    } catch (failure) { failed(failure); }
    finally { finish(); }
  }
  async function unlock(event: FormEvent) {
    event.preventDefault(); start();
    try { await release(); await prepare(path, password); }
    catch (failure) { failed(failure); }
    finally { finish(); }
  }
  async function importProject(event: FormEvent) {
    event.preventDefault();
    if (!preview?.token || !name.trim()) return;
    start();
    try {
      const project = await invoke<PostgresProject>("import_postgres_project_file_command", { request: { name: name.trim(), token: preview.token } });
      activeId.current = null;
      if (mounted.current) onImported(project);
    } catch (failure) { failed(failure); }
    finally { finish(); }
  }
  async function cancel() {
    cancelRequested.current = true; setCancelling(true);
    if (activeId.current) {
      try { await invoke("cancel_project_import_command", { id: activeId.current }); }
      catch (failure) { setError(String(failure)); setCancelling(false); }
    }
  }
  const count = (...names: string[]) => names.map((name) => preview?.counts[name]).find((count) => count !== undefined) ?? 0;
  const progressKeys = { reading: "projectImport.reading", extracting: "projectImport.extracting", verifying: "projectImport.verifying", decrypting: "projectImport.decrypting", importing: "projectImport.importing", copying: "projectImport.copying" } as const;
  return (
    <SettingsModal title={t("projectImport.title")} onClose={onClose} closeDisabled={busy}>
      <div className="app-settings-modal-body"><div className="app-settings-modal-sections"><section className="app-settings-modal-section">
        <p className="auth-hint">{t("projectImport.description")}</p>
        <button className="btn" type="button" onClick={() => void chooseFile()} disabled={busy}>{t("projectImport.chooseFile")}</button>
        {path ? <p className="auth-hint">{path.split(/[\\/]/).pop()}</p> : null}
        {error ? <p className="auth-error" role="alert">{error}</p> : null}
        {locked ? <form onSubmit={unlock}>
          <label className="form-label" htmlFor="project-import-password">{t("projectImport.password")}</label>
          <input id="project-import-password" className="form-input" type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} required />
          <div className="modal-actions"><button className="btn btn--primary" type="submit" disabled={busy || !password}>{t("projectImport.unlock")}</button></div>
        </form> : null}
        {preview ? <form onSubmit={importProject}>
          <label className="form-label" htmlFor="project-import-name">{t("projectImport.name")}</label>
          <input id="project-import-name" className="form-input" value={name} onChange={(event) => setName(event.target.value)} disabled={busy} required />
          <p className="auth-hint">{t("projectImport.summary", { sources: count("sources", "documents"), codes: count("codes"), annotations: count("annotations"), memos: count("memos") })}</p>
          <p className="auth-hint">{t("projectImport.access")}</p>
          {preview.warnings.length ? <div className="settings-warning" role="status"><p>{t("projectImport.warnings")}</p><ul>{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}
          <div className="modal-actions"><button className="btn btn--primary" type="submit" disabled={busy || !name.trim()}>{t("projectImport.submit")}</button></div>
        </form> : null}
        {busy ? <div role="status" aria-live="polite">
          <p>{cancelling ? t("projectImport.cancelling") : t(progress ? progressKeys[progress.phase] : "projectImport.reading")}</p>
          {progress && progress.total > 0 ? <progress style={{ width: "100%" }} max={progress.total} value={Math.min(progress.completed, progress.total)} aria-label={t(progressKeys[progress.phase])} /> : null}
          {activeId.current ? <button className="btn" type="button" disabled={cancelling} onClick={() => void cancel()}>{t("common.cancel")}</button> : null}
        </div> : null}
      </section></div></div>
    </SettingsModal>
  );
}
