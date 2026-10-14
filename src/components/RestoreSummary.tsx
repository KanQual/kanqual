import { useI18n } from "../i18n/provider";

/** Shared by startup and installation restore, before and after restoration. */
export function RestoreSummary({ version, projects, files, users }: {
  version: string; projects: number; files: number; users: number | null;
}) {
  const { t, formatNumber } = useI18n();
  return <div className="settings-diagnostics-grid">
    <div><span>{t("auth.postgresLaunch.backupVersion")}</span><strong>{version}</strong></div>
    <div><span>{t("auth.postgresLaunch.projects")}</span><strong>{formatNumber(projects)}</strong></div>
    <div><span>{t("auth.postgresLaunch.files")}</span><strong>{formatNumber(files)}</strong></div>
    <div><span>{t("auth.postgresLaunch.users")}</span><strong>{users === null ? t("installationRestore.unknownUsers") : formatNumber(users)}</strong></div>
  </div>;
}
