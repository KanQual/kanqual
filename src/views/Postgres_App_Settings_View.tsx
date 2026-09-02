import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { ActiveThemePreviewRow } from "../components/ActiveThemePreviewRow";
import { LanguageSettingsModal } from "../components/LanguageSettingsModal";
import { ThemeManagerModal } from "../components/ThemeManagerModal";
import { SettingsModal } from "../components/SettingsModal";
import { DownloadIcon, EyeIcon, EyeOffIcon, HelpIcon } from "../components/AppIcons";
import { FilterIcon } from "../components/FilterIcon";
import { SUPPORTED_LOCALES } from "../i18n";
import { useI18n } from "../i18n/provider";
import { getAppRuntimeInfo, type AppRuntimeInfo } from "../lib/dataRoot";
import { buildPermissionMatrixRows } from "../lib/permissionMatrix";
import {
  deletePostgresProject,
  getPostgresUserPreferences,
  listPostgresProjectLog,
  listPostgresSources,
  savePostgresUserPreferences,
  updatePostgresProject,
  type PostgresAuthSession,
  type PostgresProject,
  type PostgresProjectLogEntry,
  type PostgresSource,
  type PostgresUserPreferences,
} from "../lib/postgres";
import {
  applyDensity,
  applyFontSize,
  getStoredTheme,
  getStoredThemeState,
  initTheme,
  setActivePresetId,
  setRuntimeThemePreferences,
  type Density,
  type FontSize,
  type Theme,
} from "../theme";
import { PostgresUserSettingsView } from "./Postgres_User_Settings_View";
import thirdPartyNoticesRaw from "../../THIRD_PARTY_NOTICES.md?raw";
import {
  deletePostgresProjectBackup,
  createPostgresProjectBackup,
  formatPostgresBackupSize,
  importPostgresProjectBackupAsProject,
  loadPostgresProjectBackupManifest,
  postgresBackupRetentionStatus,
  type BackupRetentionStatus,
  type PostgresProjectBackupEntry,
  type PostgresProjectBackupManifest,
} from "../lib/postgresProjectBackups";
import { fetchPostgresProjectExportData, importPostgresRefiQdaCodebook } from "../lib/postgresProjectExport";
import {
  makeProjectBackupJson,
  makeProjectBackupXlsx,
  makeRefiQdaCodebook,
  makeRefiQdaProject,
  parseRefiQdaCodebook,
} from "../lib/projectExport";
import {
  formatProjectLogDateTime,
  parseProjectLogDetails,
  projectLogAccessModeLabel,
  projectLogActionCategory,
  projectLogActionLabel,
  projectLogDescriptionLabel,
  ProjectLogDetailsPanel,
  summarizeProjectLogDetails,
} from "./Project_Log_View";
import {
  clearPendingProjectBackupAttempt,
  clearProjectBackupBannerIssue,
  notifyProjectBackupsChanged,
  OPEN_PROJECT_SETTINGS_MODAL_EVENT,
} from "../lib/projectBackupBanner";

export type PostgresAppSettingsViewProps = {
  authSession: PostgresAuthSession;
  project?: PostgresProject;
  canManageProject?: boolean;
  canEditProjectMetadata?: boolean;
  memberCount?: number;
  ownerCount?: number;
  objectCount?: number;
  relationshipCount?: number;
  onProjectUpdated?: (project: PostgresProject) => void;
  onProjectDeleted?: (projectId: string) => void;
  onProjectOpened?: (project: PostgresProject) => void | Promise<void>;
  onAuthSessionUpdated?: (session: PostgresAuthSession) => void;
  onAuthSessionInvalidated?: () => void;
};

type AppSettingsModalId =
  | "about"
  | "appearance"
  | "language"
  | "permissions";

type LicenseRow = {
  name: string;
  version: string;
  license: string;
};

function parseMarkdownLicenseTable(markdown: string, heading: string): LicenseRow[] {
  const sectionPattern = new RegExp(`## ${heading}\\r?\\n([\\s\\S]*?)(\\r?\\n## |$)`);
  const sectionMatch = markdown.match(sectionPattern);
  if (!sectionMatch) return [];

  const lines = sectionMatch[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const tableLines = lines.filter((line) => line.startsWith("|"));
  if (tableLines.length < 3) return [];

  return tableLines.slice(2).map((line) => {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim().replace(/^`|`$/g, ""));
    return {
      name: cells[0] ?? "",
      version: cells[1] ?? "",
      license: cells[2] ?? "",
    };
  });
}

const aboutJavascriptLicenses = parseMarkdownLicenseTable(
  thirdPartyNoticesRaw,
  "Resolved JavaScript / TypeScript Dependency Inventory",
);

const aboutRustLicenses = parseMarkdownLicenseTable(
  thirdPartyNoticesRaw,
  "Resolved Rust Crate Inventory",
);

const RELEASE_DATE = "June 12, 2026";

function SettingsModalSection({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className="app-settings-modal-section">
      <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
        <h3>{title}</h3>
      </div>
      {children ? <div className="app-settings-modal-section-body">{children}</div> : null}
    </section>
  );
}

function describeAppSettingsUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function applyPostgresRuntimeThemePreferences(preferences: PostgresUserPreferences): void {
  setRuntimeThemePreferences({
    theme: preferences.theme,
    density: preferences.density,
    fontSize: preferences.fontSize,
    themeState: preferences.themeState,
  });
  initTheme();
}

type EmbeddedPostgresProjectSettingsProps = {
  project: PostgresProject;
  canManageProject: boolean;
  canEditProjectMetadata?: boolean;
  memberCount: number;
  ownerCount: number;
  objectCount: number;
  relationshipCount: number;
  onProjectUpdated: (project: PostgresProject) => void;
  onProjectDeleted: (projectId: string) => void;
  onProjectOpened?: (project: PostgresProject) => void | Promise<void>;
  embedded?: boolean;
};

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function formatPostgresDateTime(iso: string): string {
  if (!iso) return "-";
  try {
    return new Intl.DateTimeFormat([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "-";
  }
}

function formatSnapshotCreatedParts(iso: string): { date: string; time: string } {
  if (!iso) return { date: "-", time: "" };
  try {
    const date = new Date(iso);
    return {
      date: new Intl.DateTimeFormat([], {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(date),
      time: new Intl.DateTimeFormat([], {
        hour: "2-digit",
        minute: "2-digit",
      }).format(date),
    };
  } catch {
    return { date: "-", time: "" };
  }
}

function safeExportName(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "kanqual_project";
}

function backupReasonLabel(entry: PostgresProjectBackupEntry): string {
  if (entry.reason === "manual") return "Manual";
  return "Automatic";
}

function formatSnapshotHour(date: Date): string {
  return new Intl.DateTimeFormat([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
  }).format(date);
}

function formatSnapshotDay(date: Date): string {
  return new Intl.DateTimeFormat([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function snapshotRetentionUntilLabel(status: BackupRetentionStatus): string {
  if (status.category === "manual") {
    return "Indefinite";
  }
  if (status.category === "latest") {
    return "Until superseded";
  }
  if (status.category === "pending-delete") {
    return "Next cleanup";
  }
  if (status.deletionDate) {
    return formatSnapshotDay(status.deletionDate);
  }
  return "-";
}

type SnapshotRetentionBadgeKind = "manual" | "hourly" | "daily" | "weekly" | "promotion" | "empty";
type ProjectLogFilterColumn = "time" | "user" | "access" | "category" | "description";

function snapshotRetentionBucketLabels(status: BackupRetentionStatus): Array<{ label: string; kind: SnapshotRetentionBadgeKind }> {
  const labels: Array<{ label: string; kind: SnapshotRetentionBadgeKind }> = [];
  if (status.category === "manual") {
    labels.push({ label: "Manual", kind: "manual" });
  } else if (status.category === "hourly" && status.bucketStart) {
    labels.push({ label: `Hourly: ${formatSnapshotHour(status.bucketStart)}`, kind: "hourly" });
  } else if (status.category === "daily" && status.bucketStart) {
    labels.push({ label: `Daily: ${formatSnapshotDay(status.bucketStart)}`, kind: "daily" });
  } else if (status.category === "weekly" && status.bucketStart) {
    labels.push({ label: `Weekly: ${formatSnapshotDay(status.bucketStart)}`, kind: "weekly" });
  } else if (!status.promotion) {
    labels.push({ label: "-", kind: "empty" });
  }
  if (status.promotion) {
    labels.push({ label: `Will become ${status.promotion}`, kind: "promotion" });
  }
  return labels;
}

function snapshotRetentionBadgeClass(kind: SnapshotRetentionBadgeKind): string {
  return `backup-badge backup-badge--retention backup-badge--retention-${kind}`;
}

function projectCreationSourceLabel(source: string): string {
  switch (source) {
    case "snapshot": return "Snapshot";
    case "kanqual_export": return "KanQual export";
    case "refi_qda": return "REFI-QDA";
    case "manual": return "Manual";
    default: return source ? source.replace(/_/g, " ") : "Manual";
  }
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function EmbeddedPostgresProjectSettings({
  project,
  canManageProject,
  canEditProjectMetadata = canManageProject,
  memberCount,
  ownerCount,
  onProjectUpdated,
  onProjectDeleted,
  onProjectOpened,
  embedded = false,
}: EmbeddedPostgresProjectSettingsProps) {
  const { t } = useI18n();
  const [activeModal, setActiveModal] = useState<"details" | "storage" | "uploaded-files" | "backups" | "log" | "export" | "codebook" | "danger" | null>(null);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [deleteConfirmationName, setDeleteConfirmationName] = useState("");
  const [submitting, setSubmitting] = useState<"details" | "delete" | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [sources, setSources] = useState<PostgresSource[]>([]);
  const [projectLogEntries, setProjectLogEntries] = useState<PostgresProjectLogEntry[]>([]);
  const [expandedLogIds, setExpandedLogIds] = useState<Record<string, boolean>>({});
  const [projectLogFilterOpen, setProjectLogFilterOpen] = useState(false);
  const [projectLogFilters, setProjectLogFilters] = useState<Record<ProjectLogFilterColumn, string>>({
    time: "",
    user: "",
    access: "",
    category: "",
    description: "",
  });
  const [backupManifest, setBackupManifest] = useState<PostgresProjectBackupManifest | null>(null);
  const [backupBusy, setBackupBusy] = useState<"manual" | "delete" | "import" | null>(null);
  const [backupError, setBackupError] = useState("");
  const [backupNotice, setBackupNotice] = useState("");
  const [deleteBackup, setDeleteBackup] = useState<PostgresProjectBackupEntry | null>(null);
  const [importBackup, setImportBackup] = useState<PostgresProjectBackupEntry | null>(null);
  const [importBackupProjectName, setImportBackupProjectName] = useState("");
  const [importedBackupProject, setImportedBackupProject] = useState<PostgresProject | null>(null);
  const [openBackupActionsFile, setOpenBackupActionsFile] = useState<string | null>(null);
  const backupActionsMenuRef = useRef<HTMLTableCellElement | null>(null);
  const [exporting, setExporting] = useState<"json" | "xlsx" | "qdpx" | "encrypted" | null>(null);
  const [exportError, setExportError] = useState("");
  const [encryptedBackupPassword, setEncryptedBackupPassword] = useState("");
  const [encryptedBackupPasswordConfirm, setEncryptedBackupPasswordConfirm] = useState("");
  const [encryptedBackupPasswordVisible, setEncryptedBackupPasswordVisible] = useState(false);
  const [encryptedBackupPasswordConfirmVisible, setEncryptedBackupPasswordConfirmVisible] = useState(false);
  const [codebookBusy, setCodebookBusy] = useState<"export" | "import" | null>(null);
  const [codebookError, setCodebookError] = useState("");
  const [codebookImportResult, setCodebookImportResult] = useState<{ importedCount: number } | null>(null);
  const [projectLogExporting, setProjectLogExporting] = useState(false);

  useEffect(() => {
    setName(project.name);
    setDescription(project.description);
  }, [project.description, project.name]);

  useEffect(() => {
    if (!openBackupActionsFile) return;
    function onPointerDown(event: PointerEvent) {
      if (backupActionsMenuRef.current?.contains(event.target as Node)) return;
      setOpenBackupActionsFile(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [openBackupActionsFile]);

  async function loadSources() {
    try {
      setSources(await listPostgresSources(project.id));
    } catch (loadError) {
      setError(describeUnknownError(loadError));
    }
  }

  async function loadProjectLog() {
    try {
      setProjectLogEntries(await listPostgresProjectLog(project.id));
    } catch (loadError) {
      setError(describeUnknownError(loadError));
    }
  }

  async function loadBackups() {
    try {
      setBackupManifest(await loadPostgresProjectBackupManifest(project));
    } catch (loadError) {
      setBackupError(describeUnknownError(loadError));
    }
  }

  const retainedSources = useMemo(
    () => sources.filter((source) => source.storagePath || source.originalFileName),
    [sources],
  );

  const sortedProjectLogEntries = useMemo(() => {
    const normalizedFilters = Object.fromEntries(
      Object.entries(projectLogFilters).map(([key, value]) => [key, value.trim().toLowerCase()]),
    ) as Record<ProjectLogFilterColumn, string>;
    return [...projectLogEntries]
      .filter((entry) => {
        const values: Record<ProjectLogFilterColumn, string> = {
          time: formatProjectLogDateTime(entry.occurredAt).toLowerCase(),
          user: (entry.userName || "-").toLowerCase(),
          access: projectLogAccessModeLabel(entry.accessMode, t).toLowerCase(),
          category: projectLogActionLabel(entry.action, t).toLowerCase(),
          description: projectLogDescriptionLabel(entry, parseProjectLogDetails(entry.detailsJson), t).toLowerCase(),
        };
        return (Object.keys(normalizedFilters) as ProjectLogFilterColumn[]).every((column) => {
          const filter = normalizedFilters[column];
          return !filter || values[column].includes(filter);
        });
      })
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  }, [projectLogEntries, projectLogFilters, t]);

  async function handleExport(format: "json" | "xlsx" | "qdpx") {
    setExportError("");
    setExporting(format);
    try {
      const extension = format === "json" ? "json" : format === "xlsx" ? "xlsx" : "qdpx";
      const path = await save({
        defaultPath: `${safeExportName(project.name)}_export.${extension}`,
        filters: [{ name: `${extension.toUpperCase()} file`, extensions: [extension] }],
      });
      if (!path) return;
      const data = await fetchPostgresProjectExportData(project);
      if (format === "json") {
        await writeTextFile(path, makeProjectBackupJson(data));
      } else if (format === "xlsx") {
        await writeFile(path, makeProjectBackupXlsx(data));
      } else {
        await writeFile(path, makeRefiQdaProject(data));
      }
      setNotice(`Exported ${format.toUpperCase()} project data.`);
    } catch (exportFailure) {
      setExportError(describeUnknownError(exportFailure));
    } finally {
      setExporting(null);
    }
  }

  async function handleEncryptedBackupExport() {
    setExportError("");
    if (!encryptedBackupPassword || encryptedBackupPassword !== encryptedBackupPasswordConfirm) {
      setExportError("Enter matching backup passwords.");
      return;
    }
    setExporting("encrypted");
    try {
      const path = await save({
        defaultPath: `${safeExportName(project.name)}_encrypted_backup.kqbe`,
        filters: [{ name: "KanQual encrypted backup", extensions: ["kqbe"] }],
      });
      if (!path) return;
      const data = await fetchPostgresProjectExportData(project);
      const encryptedBackup = await invoke<string>("encrypt_project_backup", {
        request: {
          backupJson: makeProjectBackupJson(data),
          password: encryptedBackupPassword,
        },
      });
      await writeTextFile(path, encryptedBackup);
      setEncryptedBackupPassword("");
      setEncryptedBackupPasswordConfirm("");
      setNotice("Exported encrypted project backup.");
    } catch (exportFailure) {
      setExportError(describeUnknownError(exportFailure));
    } finally {
      setExporting(null);
    }
  }

  async function handleProjectLogExport() {
    setExportError("");
    setProjectLogExporting(true);
    try {
      const path = await save({
        defaultPath: `${safeExportName(project.name)}_project_log.csv`,
        filters: [{ name: "CSV file", extensions: ["csv"] }],
      });
      if (!path) return;
      const entries = projectLogEntries.length ? sortedProjectLogEntries : await listPostgresProjectLog(project.id);
      const csv = [
        ["Time", "User", "Access", "Category", "Action", "Description"].map(csvEscape).join(","),
        ...entries.map((entry) => [
          csvEscape(formatProjectLogDateTime(entry.occurredAt)),
          csvEscape(entry.userName || "-"),
          csvEscape(projectLogAccessModeLabel(entry.accessMode, t)),
          csvEscape(projectLogActionCategory(entry.action)),
          csvEscape(projectLogActionLabel(entry.action, t)),
          csvEscape(entry.label || ""),
        ].join(",")),
      ].join("\n");
      await writeTextFile(path, csv);
      setNotice("Exported project log.");
    } catch (exportFailure) {
      setExportError(describeUnknownError(exportFailure));
    } finally {
      setProjectLogExporting(false);
    }
  }

  async function handleManualBackup() {
    setBackupError("");
    setBackupNotice("");
    if (!canManageProject) {
      setBackupError("Only project owners or administrators can create project snapshots.");
      return;
    }
    setBackupBusy("manual");
    try {
      const { manifest } = await createPostgresProjectBackup(project, "manual");
      setBackupManifest(manifest);
      clearPendingProjectBackupAttempt(project.id);
      clearProjectBackupBannerIssue(project.id);
      notifyProjectBackupsChanged(project.id);
      setBackupNotice("Snapshot created.");
    } catch (backupFailure) {
      setBackupError(describeUnknownError(backupFailure));
    } finally {
      setBackupBusy(null);
    }
  }

  async function handleDeleteBackup() {
    if (!deleteBackup) return;
    setBackupError("");
    if (!canManageProject) {
      setBackupError("Only project owners or administrators can delete project snapshots.");
      setDeleteBackup(null);
      return;
    }
    if (!deleteBackup.manual) {
      setBackupError("Automatic and session snapshots are managed by retention settings.");
      setDeleteBackup(null);
      return;
    }
    setBackupBusy("delete");
    try {
      setBackupManifest(await deletePostgresProjectBackup(project, deleteBackup));
      setDeleteBackup(null);
      setBackupNotice("Snapshot deleted.");
    } catch (deleteFailure) {
      setBackupError(describeUnknownError(deleteFailure));
    } finally {
      setBackupBusy(null);
    }
  }

  async function handleImportBackup() {
    if (!importBackup) return;
    setBackupError("");
    setBackupNotice("");
    if (!importBackupProjectName.trim()) {
      setBackupError("Enter a name for the new project.");
      return;
    }
    if (!canManageProject) {
      setBackupError("Only project owners or administrators can restore project snapshots.");
      setImportBackup(null);
      return;
    }
    setBackupBusy("import");
    try {
      const imported = await importPostgresProjectBackupAsProject(project, importBackup, {
        name: importBackupProjectName.trim(),
      });
      setImportedBackupProject(imported);
      setImportBackup(null);
      setImportBackupProjectName("");
      setBackupNotice(`Restored snapshot as "${imported.name}".`);
    } catch (importFailure) {
      setBackupError(describeUnknownError(importFailure));
    } finally {
      setBackupBusy(null);
    }
  }

  async function handleCodebookExport() {
    setCodebookError("");
    setCodebookBusy("export");
    try {
      const path = await save({
        defaultPath: `${safeExportName(project.name)}_codebook.qdc`,
        filters: [{ name: "REFI-QDA Codebook", extensions: ["qdc"] }],
      });
      if (!path) return;
      const data = await fetchPostgresProjectExportData(project);
      await writeTextFile(path, makeRefiQdaCodebook(data));
      setNotice("Exported codebook.");
    } catch (exportFailure) {
      setCodebookError(describeUnknownError(exportFailure));
    } finally {
      setCodebookBusy(null);
    }
  }

  async function handleCodebookImport() {
    setCodebookError("");
    setCodebookBusy("import");
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "REFI-QDA Codebook", extensions: ["qdc", "xml"] }],
      });
      if (!path || Array.isArray(path)) return;
      const codes = parseRefiQdaCodebook(await readTextFile(path));
      const importedCount = await importPostgresRefiQdaCodebook(project.id, codes);
      setCodebookImportResult({ importedCount });
    } catch (importFailure) {
      setCodebookError(describeUnknownError(importFailure));
    } finally {
      setCodebookBusy(null);
    }
  }

  async function handleSaveDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!canEditProjectMetadata) {
      setError("Only project owners, editors, or the PostgreSQL administrator can change project details.");
      return;
    }
    if (!name.trim()) {
      setError("Enter a project name.");
      return;
    }

    setSubmitting("details");
    try {
      const updated = await updatePostgresProject({
        projectId: project.id,
        name: name.trim(),
        description: description.trim(),
      });
      onProjectUpdated(updated);
      setActiveModal(null);
      setNotice(`Updated PostgreSQL project "${updated.name}".`);
    } catch (updateError) {
      setError(describeUnknownError(updateError));
    } finally {
      setSubmitting(null);
    }
  }

  async function handleDeleteProject() {
    setError("");
    setNotice("");
    if (!canManageProject) {
      setError("Only project owners or the PostgreSQL administrator can delete this project.");
      return;
    }
    if (deleteConfirmationName.trim() !== project.name.trim()) {
      setError("Enter the exact project name to confirm deletion.");
      return;
    }

    setSubmitting("delete");
    try {
      await deletePostgresProject(project.id);
      onProjectDeleted(project.id);
    } catch (deleteError) {
      setError(describeUnknownError(deleteError));
      setSubmitting(null);
    }
  }

  function openRequestedProjectSettingsModal() {
    const requestedModal = sessionStorage.getItem("kanqual:open-project-settings-modal");
    if (requestedModal !== "backups") return;
    sessionStorage.removeItem("kanqual:open-project-settings-modal");
    setBackupError("");
    setBackupNotice("");
    setActiveModal("backups");
    void loadBackups();
  }

  useEffect(() => {
    openRequestedProjectSettingsModal();

    function handleOpenProjectSettingsModal() {
      openRequestedProjectSettingsModal();
    }

    window.addEventListener(OPEN_PROJECT_SETTINGS_MODAL_EVENT, handleOpenProjectSettingsModal);
    return () => {
      window.removeEventListener(OPEN_PROJECT_SETTINGS_MODAL_EVENT, handleOpenProjectSettingsModal);
    };
  }, [project.id]);

  const projectSettingsSections = [
    {
      heading: "Project",
      cards: [
        {
          id: "details",
          title: "Details",
          icon: "DE",
          description: "Rename the project and edit its description.",
          onOpen: () => {
            setError("");
            setName(project.name);
            setDescription(project.description);
            setActiveModal("details");
          },
        },
        {
          id: "storage",
          title: "Storage",
          icon: "HD",
          description: "See the per-project database name, file location, and timestamps.",
          onOpen: () => {
            setError("");
            setActiveModal("storage");
          },
        },
      ],
    },
    {
      heading: "Project Data",
      cards: [
        {
          id: "uploaded-files",
          title: "Uploaded Files",
          icon: "UP",
          description: "Review retained source file metadata for this project.",
          onOpen: () => {
            setError("");
            setActiveModal("uploaded-files");
            void loadSources();
          },
        },
        {
          id: "backups",
          title: "Snapshots",
          icon: "SN",
          description: "Create and review project-level snapshots.",
          onOpen: () => {
            setBackupError("");
            setBackupNotice("");
            setActiveModal("backups");
            void loadBackups();
          },
        },
        {
          id: "log",
          title: "Log",
          icon: "LG",
          description: "Review and export this project's activity log.",
          onOpen: () => {
            setError("");
            setActiveModal("log");
            void loadProjectLog();
          },
        },
      ],
    },
    {
      heading: "Exchange",
      cards: [
        {
          id: "export",
          title: "Export",
          icon: "EX",
          description: "Export project data as JSON, Excel, REFI-QDA, or encrypted backup.",
          onOpen: () => {
            setExportError("");
            setActiveModal("export");
          },
        },
        {
          id: "codebook",
          title: "Codebook",
          icon: "CB",
          description: "Import or export a REFI-QDA codebook file.",
          onOpen: () => {
            setCodebookError("");
            setActiveModal("codebook");
          },
        },
        {
          id: "danger",
          title: "Delete Project",
          icon: "DL",
          description: "Permanently remove this project and its dedicated PostgreSQL database.",
          requiresProjectManagement: true,
          onOpen: () => {
            setError("");
            setDeleteConfirmationName("");
            setActiveModal("danger");
          },
        },
      ],
    },
  ];
  const visibleProjectSettingsSections = projectSettingsSections
    .map((section) => ({
      ...section,
      cards: section.cards.filter((card) => !card.requiresProjectManagement || canManageProject),
    }))
    .filter((section) => section.cards.length > 0);
  const projectSettingsCards = visibleProjectSettingsSections.flatMap((section) => section.cards);

  function renderProjectSettingsCard(card: (typeof projectSettingsCards)[number]) {
    return (
      <button
        key={card.id}
        type="button"
        className={embedded ? "app-settings-overview-card app-settings-overview-card--compact app-settings-overview-card--default" : "app-settings-overview-card app-settings-overview-card--default"}
        onClick={card.onOpen}
      >
        {embedded ? <span className="app-settings-overview-card-icon" aria-hidden="true">{card.icon}</span> : null}
        <h3>{card.title}</h3>
        {!embedded ? <p>{card.description}</p> : null}
      </button>
    );
  }

  return (
    <div className={embedded ? "project-settings-view project-settings-view--embedded" : "view project-settings-view"}>
      {!embedded ? (
        <header className="view-header">
          <div className="view-title-with-help">
            <h1>Project Settings</h1>
          </div>
        </header>
      ) : null}

      {notice ? <p className="settings-success">{notice}</p> : null}
      {error ? <p className="auth-error">{error}</p> : null}

      <div className="app-settings-overview-shell project-settings-overview-shell">
        <div className={embedded ? "app-settings-overview-stack app-settings-overview-stack--compact" : "app-settings-overview-stack"}>
          {embedded ? (
            <div className="app-settings-overview-grid app-settings-overview-grid--compact">
              {projectSettingsCards.map(renderProjectSettingsCard)}
            </div>
          ) : (
            <div className="app-settings-overview-sections">
              {visibleProjectSettingsSections.map((section) => (
                <section key={section.heading} className="app-settings-overview-section">
                  <div className="app-settings-overview-section-header">
                    <p className="app-settings-overview-section-heading">{section.heading}</p>
                  </div>
                  <div className="app-settings-overview-grid">
                    {section.cards.map(renderProjectSettingsCard)}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      {activeModal === "details" ? (
        <SettingsModal title="Project Details" onClose={() => setActiveModal(null)} closeDisabled={submitting === "details"}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Metadata</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="home-restricted-list" style={{ marginBottom: 16 }}>
                      <div className="home-restricted-item">
                        <span className="home-restricted-label">Created from</span>
                        <span className="home-restricted-value">{projectCreationSourceLabel(project.creationSource)}</span>
                      </div>
                      <div className="home-restricted-item">
                        <span className="home-restricted-label">Created at</span>
                        <span className="home-restricted-value">{formatPostgresDateTime(project.createdAt)}</span>
                      </div>
                      <div className="home-restricted-item">
                        <span className="home-restricted-label">Created by</span>
                        <span className="home-restricted-value">{project.createdByUsername || "Unknown"}</span>
                      </div>
                    </div>
                    <form className="form" onSubmit={handleSaveDetails}>
                      <label className="form-label">
                        Project name
                        <input
                          className="form-input"
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          disabled={submitting === "details" || !canEditProjectMetadata}
                          autoFocus
                        />
                      </label>
                      <label className="form-label">
                        Description
                        <textarea
                          className="form-input form-textarea"
                          rows={5}
                          value={description}
                          onChange={(event) => setDescription(event.target.value)}
                          disabled={submitting === "details" || !canEditProjectMetadata}
                        />
                      </label>
                      {!canEditProjectMetadata ? (
                        <p className="auth-hint" style={{ marginTop: 0 }}>
                          Only project owners, editors, or the PostgreSQL administrator can change these details.
                        </p>
                      ) : null}
                      <div className="form-actions">
                        <button type="button" className="btn" onClick={() => setActiveModal(null)} disabled={submitting === "details"}>
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="btn btn--primary"
                          disabled={submitting === "details" || !canEditProjectMetadata || !name.trim()}
                        >
                          {submitting === "details" ? "Saving..." : "Save changes"}
                        </button>
                      </div>
                    </form>
                  </div>
                </section>
              </div>
            </div>
        </SettingsModal>
      ) : null}

      {activeModal === "storage" ? (
        <SettingsModal title="Project Storage" onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Dedicated Database</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="home-restricted-list">
                      <div className="home-restricted-item"><span className="home-restricted-label">Database name</span><span className="home-restricted-value">{project.databaseName || "-"}</span></div>
                      <div className="home-restricted-item">
                        <span className="home-restricted-label">Storage path</span>
                        <span className="home-restricted-value" style={{ textAlign: "right", overflowWrap: "anywhere" }}>
                          {project.storagePath || "-"}
                        </span>
                      </div>
                      <div className="home-restricted-item"><span className="home-restricted-label">Created</span><span className="home-restricted-value">{formatPostgresDateTime(project.createdAt)}</span></div>
                      <div className="home-restricted-item"><span className="home-restricted-label">Last updated</span><span className="home-restricted-value">{formatPostgresDateTime(project.updatedAt)}</span></div>
                      <div className="home-restricted-item"><span className="home-restricted-label">Owners</span><span className="home-restricted-value">{ownerCount}</span></div>
                      <div className="home-restricted-item"><span className="home-restricted-label">Members</span><span className="home-restricted-value">{memberCount}</span></div>
                    </div>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button>
            </div>
        </SettingsModal>
      ) : null}

      {activeModal === "uploaded-files" ? (
        <SettingsModal title="Uploaded Files" onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Retained Source Files</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="backup-list">
                      {retainedSources.length > 0 ? retainedSources.map((source) => (
                        <div key={source.id} className="backup-list-item">
                          <div>
                            <div className="backup-list-title">
                              {source.originalFileName || source.title || "Untitled source"}
                              <span className="backup-badge backup-badge--scheduled">{source.sourceKind}</span>
                            </div>
                            <div className="backup-list-meta">
                              {source.title}
                              {source.storagePath ? ` | ${source.storagePath}` : ""}
                            </div>
                            <div className="backup-list-meta">
                              Imported {formatPostgresDateTime(source.createdAt)}
                            </div>
                          </div>
                        </div>
                      )) : (
                        <div className="empty-state backup-empty-state">
                          <p>No retained source files were found for this project.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button>
            </div>
        </SettingsModal>
      ) : null}

      {activeModal === "backups" ? (
        <SettingsModal title="Snapshots" onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                {backupError ? <div className="form-error project-settings-error">{backupError}</div> : null}
                {backupNotice ? <div className="settings-success project-settings-success">{backupNotice}</div> : null}
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-body">
                    <div className="backup-create-actions">
                      <button
                        className="btn"
                        onClick={() => void handleManualBackup()}
                        disabled={backupBusy === "manual" || !canManageProject}
                        title={!canManageProject ? "Only project owners or administrators can create project snapshots." : undefined}
                      >
                        {backupBusy === "manual" ? "Creating..." : "Create Snapshot Now"}
                      </button>
                    </div>
                    {!canManageProject ? (
                      <p className="auth-hint" style={{ marginBottom: 0 }}>
                        Only project owners or administrators can create, delete, or restore project snapshots.
                      </p>
                    ) : null}
                  </div>
                </section>
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Available Snapshots</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="backup-list">
                      {backupManifest?.backups.length ? (
                        <div className="project-log-table-wrap snapshot-table-wrap">
                          <table className="project-log-table snapshot-table">
                            <thead>
                              <tr>
                                <th>Created</th>
                                <th>Retained Until</th>
                                <th>Retention</th>
                                <th>Reason</th>
                                <th>Total</th>
                                <th>Trigger</th>
                                <th>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {backupManifest.backups.map((backup) => {
                                const retentionStatus = postgresBackupRetentionStatus(
                                  backup,
                                  backupManifest.backups,
                                  backupManifest.retention,
                                );
                                const retentionLabels = snapshotRetentionBucketLabels(retentionStatus);
                                const createdParts = formatSnapshotCreatedParts(backup.createdAt);
                                return (
                                  <tr key={backup.file}>
                                    <td className="log-cell log-cell--time snapshot-created-cell">
                                      <span>{createdParts.date}</span>
                                      {createdParts.time ? <span>{createdParts.time}</span> : null}
                                    </td>
                                    <td className="log-cell log-cell--time">{snapshotRetentionUntilLabel(retentionStatus)}</td>
                                    <td className="log-cell snapshot-retention-cell">
                                      {retentionLabels.map((item) => (
                                        <span
                                          key={item.label}
                                          className={snapshotRetentionBadgeClass(item.kind)}
                                        >
                                          {item.label}
                                        </span>
                                      ))}
                                    </td>
                                    <td className="log-cell log-cell--label">{backupReasonLabel(backup)}</td>
                                    <td className="log-cell log-cell--time">{formatPostgresBackupSize(backup.sizeBytes) || "0 B"}</td>
                                    <td className="log-cell log-cell--label">{backup.sourceLogLabel ? `Triggered by ${backup.sourceLogLabel}` : "-"}</td>
                                    <td
                                      className="log-cell snapshot-table-actions"
                                      ref={openBackupActionsFile === backup.file ? backupActionsMenuRef : undefined}
                                    >
                                      <button
                                        type="button"
                                        className="snapshot-actions-trigger"
                                        onClick={() => {
                                          setOpenBackupActionsFile((current) => current === backup.file ? null : backup.file);
                                        }}
                                        aria-label="Snapshot actions"
                                        aria-expanded={openBackupActionsFile === backup.file}
                                        title="Snapshot actions"
                                      >
                                        ...
                                      </button>
                                      {openBackupActionsFile === backup.file ? (
                                        <div className="snapshot-actions-menu" role="menu">
                                          <button
                                            type="button"
                                            className="snapshot-actions-menu-item"
                                            onClick={() => {
                                              setOpenBackupActionsFile(null);
                                              setBackupError("");
                                              setBackupNotice("");
                                              setImportBackup(backup);
                                              setImportBackupProjectName(`${project.name} Snapshot Copy`);
                                            }}
                                            disabled={!!backupBusy || !canManageProject}
                                            title={!canManageProject ? "Only project owners or administrators can restore project snapshots." : undefined}
                                            role="menuitem"
                                          >
                                            Restore
                                          </button>
                                          <button
                                            type="button"
                                            className="snapshot-actions-menu-item snapshot-actions-menu-item--danger"
                                            onClick={() => {
                                              setOpenBackupActionsFile(null);
                                              setDeleteBackup(backup);
                                            }}
                                            disabled={!!backupBusy || !canManageProject || !backup.manual}
                                            title={
                                              !canManageProject
                                                ? "Only project owners or administrators can delete project snapshots."
                                                : !backup.manual
                                                  ? "Automatic snapshots are managed by retention settings."
                                                  : undefined
                                            }
                                            role="menuitem"
                                          >
                                            Delete
                                          </button>
                                        </div>
                                      ) : null}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="empty-state backup-empty-state">
                          <p>No snapshots yet.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button>
            </div>
        </SettingsModal>
      ) : null}

      {activeModal === "log" ? (
        <SettingsModal title="Project Log" onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              {exportError ? <p className="auth-error">{exportError}</p> : null}
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-body">
                    <div className="settings-inline-actions" style={{ justifyContent: "flex-end", marginBottom: 10 }}>
                      <button
                        type="button"
                        className="codebook-icon-action"
                        onClick={() => void handleProjectLogExport()}
                        disabled={projectLogExporting}
                        aria-label="Export project log as CSV"
                        title={projectLogExporting ? "Exporting..." : "Export CSV"}
                      >
                        <DownloadIcon className="filter-icon-svg" />
                      </button>
                      <button
                        type="button"
                        className="codebook-icon-action"
                        onClick={() => setProjectLogFilterOpen(true)}
                        aria-label="Filter project log"
                        title="Filter"
                      >
                        <FilterIcon className="filter-icon-svg" />
                      </button>
                    </div>
                    {sortedProjectLogEntries.length === 0 ? (
                      <div className="empty-state backup-empty-state">
                        <p>No project activity yet.</p>
                      </div>
                    ) : (
                      <div className="project-log-table-wrap">
                        <table className="project-log-table">
                          <thead>
                            <tr>
                              <th>Time</th>
                              <th>User</th>
                              <th>Access</th>
                              <th>Category</th>
                              <th>Description</th>
                              <th>Details</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedProjectLogEntries.map((entry) => {
                              const details = parseProjectLogDetails(entry.detailsJson);
                              const isExpanded = Boolean(expandedLogIds[entry.id]);
                              const summary = details ? summarizeProjectLogDetails(entry.action, details, t) : "";
                              return (
                                <Fragment key={entry.id}>
                                  <tr className={`log-row log-row--${projectLogActionCategory(entry.action)}`}>
                                    <td className="log-cell log-cell--time">{formatProjectLogDateTime(entry.occurredAt)}</td>
                                    <td className="log-cell log-cell--user">{entry.userName || "-"}</td>
                                    <td className="log-cell log-cell--user">{projectLogAccessModeLabel(entry.accessMode, t)}</td>
                                    <td className="log-cell log-cell--action">
                                      <span className={`log-badge log-badge--${projectLogActionCategory(entry.action)}`}>
                                        {projectLogActionLabel(entry.action, t)}
                                      </span>
                                    </td>
                                    <td className="log-cell log-cell--label">
                                      <div>{projectLogDescriptionLabel(entry, details, t)}</div>
                                      {summary ? <div className="log-inline-summary">{summary}</div> : null}
                                    </td>
                                    <td className="log-cell log-cell--details-toggle">
                                      {details ? (
                                        <button
                                          type="button"
                                          className="btn btn--xs log-details-toggle"
                                          onClick={() => setExpandedLogIds((current) => ({ ...current, [entry.id]: !current[entry.id] }))}
                                          aria-expanded={isExpanded}
                                        >
                                          {isExpanded ? "Hide" : "View"}
                                        </button>
                                      ) : (
                                        <span className="log-details-none">-</span>
                                      )}
                                    </td>
                                  </tr>
                                  {details && isExpanded ? (
                                    <tr className="log-details-row">
                                      <td className="log-cell log-cell--details" colSpan={6}>
                                        <ProjectLogDetailsPanel details={details} />
                                      </td>
                                    </tr>
                                  ) : null}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button>
            </div>
        </SettingsModal>
      ) : null}

      {activeModal === "log" && projectLogFilterOpen ? (
        <SettingsModal title="Filter Project Log" onClose={() => setProjectLogFilterOpen(false)}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-body">
                    <div className="settings-form-grid">
                      {([
                        ["time", "Time"],
                        ["user", "User"],
                        ["access", "Access"],
                        ["category", "Category"],
                        ["description", "Description"],
                      ] as Array<[ProjectLogFilterColumn, string]>).map(([column, label]) => (
                        <label className="form-field" key={column}>
                          <span>{label}</span>
                          <input
                            className="form-input"
                            value={projectLogFilters[column]}
                            onChange={(event) => setProjectLogFilters((current) => ({ ...current, [column]: event.target.value }))}
                            placeholder={`Filter ${label.toLowerCase()}`}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <button
                type="button"
                className="btn"
                onClick={() => setProjectLogFilters({
                  time: "",
                  user: "",
                  access: "",
                  category: "",
                  description: "",
                })}
              >
                Clear
              </button>
              <button type="button" className="btn btn--primary" onClick={() => setProjectLogFilterOpen(false)}>Done</button>
            </div>
        </SettingsModal>
      ) : null}

      {activeModal === "export" ? (
        <SettingsModal title="Backup & Export" onClose={() => setActiveModal(null)} closeDisabled={!!exporting}>
            <div className="app-settings-modal-body">
              {exportError ? <p className="auth-error">{exportError}</p> : null}
              <div className="app-settings-modal-sections">
                <section className="project-backup-primary-panel">
                  <div className="project-backup-primary-header">
                    <div>
                      <h3>Encrypted Backup</h3>
                      <p>Create a password-protected KanQual backup for safekeeping or transfer.</p>
                    </div>
                  </div>
                  <div className="project-backup-password-grid">
                    <label className="form-label">
                      Backup Password
                      <div className="password-input-wrap">
                        <input
                          className="form-input password-input-field"
                          type={encryptedBackupPasswordVisible ? "text" : "password"}
                          value={encryptedBackupPassword}
                          onChange={(event) => setEncryptedBackupPassword(event.target.value)}
                          autoComplete="new-password"
                          disabled={!!exporting}
                        />
                        <button
                          type="button"
                          className="password-visibility-btn"
                          aria-label={encryptedBackupPasswordVisible ? "Hide password" : "Show password"}
                          aria-pressed={encryptedBackupPasswordVisible}
                          onClick={() => setEncryptedBackupPasswordVisible((current) => !current)}
                          disabled={!!exporting}
                        >
                          {encryptedBackupPasswordVisible ? <EyeOffIcon className="password-visibility-icon" /> : <EyeIcon className="password-visibility-icon" />}
                        </button>
                      </div>
                    </label>
                    <label className="form-label">
                      Confirm Password
                      <div className="password-input-wrap">
                        <input
                          className="form-input password-input-field"
                          type={encryptedBackupPasswordConfirmVisible ? "text" : "password"}
                          value={encryptedBackupPasswordConfirm}
                          onChange={(event) => setEncryptedBackupPasswordConfirm(event.target.value)}
                          autoComplete="new-password"
                          disabled={!!exporting}
                        />
                        <button
                          type="button"
                          className="password-visibility-btn"
                          aria-label={encryptedBackupPasswordConfirmVisible ? "Hide password" : "Show password"}
                          aria-pressed={encryptedBackupPasswordConfirmVisible}
                          onClick={() => setEncryptedBackupPasswordConfirmVisible((current) => !current)}
                          disabled={!!exporting}
                        >
                          {encryptedBackupPasswordConfirmVisible ? <EyeOffIcon className="password-visibility-icon" /> : <EyeIcon className="password-visibility-icon" />}
                        </button>
                      </div>
                    </label>
                  </div>
                  {encryptedBackupPasswordConfirm && encryptedBackupPassword !== encryptedBackupPasswordConfirm ? (
                    <p className="settings-warning settings-warning--danger" style={{ margin: 0 }}>
                      The password entries do not match.
                    </p>
                  ) : null}
                  <div className="project-backup-primary-actions">
                    <button className="btn btn--primary" onClick={() => void handleEncryptedBackupExport()} disabled={!!exporting || !encryptedBackupPassword || !encryptedBackupPasswordConfirm || encryptedBackupPassword !== encryptedBackupPasswordConfirm}>
                      {exporting === "encrypted" ? "Exporting..." : "Export Backup"}
                    </button>
                  </div>
                </section>

                <section className="project-export-secondary-section">
                  <h3>Other Formats</h3>
                  <p className="project-export-secondary-note">
                    These exports are not encrypted and can be read by anyone with access to the files.
                  </p>
                  <div className="project-export-format-list">
                    <div className="project-export-format-row">
                      <div>
                        <div className="project-export-format-title">JSON</div>
                        <div className="project-export-format-copy">Raw project data.</div>
                      </div>
                      <button className="btn" onClick={() => void handleExport("json")} disabled={!!exporting}>
                        {exporting === "json" ? "Exporting..." : "Export"}
                      </button>
                    </div>
                    <div className="project-export-format-row">
                      <div>
                        <div className="project-export-format-title">REFI-QDA</div>
                        <div className="project-export-format-copy">Exchange with QDA software.</div>
                      </div>
                      <button className="btn" onClick={() => void handleExport("qdpx")} disabled={!!exporting}>
                        {exporting === "qdpx" ? "Exporting..." : "Export"}
                      </button>
                    </div>
                    <div className="project-export-format-row">
                      <div>
                        <div className="project-export-format-title">Excel</div>
                        <div className="project-export-format-copy">Review workbook.</div>
                      </div>
                      <button className="btn" onClick={() => void handleExport("xlsx")} disabled={!!exporting}>
                        {exporting === "xlsx" ? "Exporting..." : "Export"}
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)} disabled={!!exporting}>Done</button>
            </div>
        </SettingsModal>
      ) : null}

      {activeModal === "codebook" ? (
        <SettingsModal title="Codebook" onClose={() => setActiveModal(null)} closeDisabled={!!codebookBusy}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                {codebookError ? <p className="auth-error">{codebookError}</p> : null}
                <section className="project-backup-primary-panel">
                  <div className="project-backup-primary-header">
                    <div>
                      <h3>REFI-QDA Codebook</h3>
                      <p>Import or export code definitions as a REFI-QDA codebook file.</p>
                    </div>
                  </div>
                  <div className="project-export-format-list">
                    <div className="project-export-format-row">
                      <div>
                        <div className="project-export-format-title">Import</div>
                        <div className="project-export-format-copy">Add codes from a REFI-QDA codebook file.</div>
                      </div>
                      <button className="btn" onClick={() => void handleCodebookImport()} disabled={!!codebookBusy}>
                        {codebookBusy === "import" ? "Importing..." : "Import"}
                      </button>
                    </div>
                    <div className="project-export-format-row">
                      <div>
                        <div className="project-export-format-title">Export</div>
                        <div className="project-export-format-copy">Save this project's codebook for use elsewhere.</div>
                      </div>
                      <button className="btn btn--primary" onClick={() => void handleCodebookExport()} disabled={!!codebookBusy}>
                        {codebookBusy === "export" ? "Exporting..." : "Export"}
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)} disabled={!!codebookBusy}>Done</button>
            </div>
        </SettingsModal>
      ) : null}

      {activeModal === "danger" ? (
        <SettingsModal title="Delete Project" onClose={() => setActiveModal(null)} closeDisabled={submitting === "delete"}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--danger">
                    <h3>Danger Zone</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <p className="settings-warning settings-warning--danger">
                      This permanently deletes <strong>{project.name}</strong>, including its dedicated database,
                      objects, relationships, and project memberships.
                    </p>
                    <label className="form-label">
                      Type the project name to confirm
                      <input
                        className="form-input"
                        value={deleteConfirmationName}
                        onChange={(event) => setDeleteConfirmationName(event.target.value)}
                        disabled={submitting === "delete" || !canManageProject}
                        autoFocus
                      />
                    </label>
                    {!canManageProject ? (
                      <p className="auth-hint" style={{ marginTop: 0 }}>
                        Only project owners or the administrator can delete this project.
                      </p>
                    ) : null}
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <button type="button" className="btn" onClick={() => setActiveModal(null)} disabled={submitting === "delete"}>Cancel</button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => void handleDeleteProject()}
                disabled={submitting === "delete" || !canManageProject || deleteConfirmationName.trim() !== project.name.trim()}
              >
                {submitting === "delete" ? "Deleting..." : "Delete project"}
              </button>
            </div>
        </SettingsModal>
      ) : null}

      {deleteBackup ? (
        <SettingsModal title="Delete Snapshot" onClose={() => setDeleteBackup(null)} closeDisabled={backupBusy === "delete"}>
            <div className="app-settings-modal-body">
              <p className="import-project-copy">
                Delete the snapshot from {formatPostgresDateTime(deleteBackup.createdAt)}?
              </p>
            </div>
            <div className="app-settings-modal-footer">
              <button type="button" className="btn" onClick={() => setDeleteBackup(null)} disabled={backupBusy === "delete"}>Cancel</button>
              <button type="button" className="btn btn--danger" onClick={() => void handleDeleteBackup()} disabled={backupBusy === "delete" || !canManageProject}>
                {backupBusy === "delete" ? "Deleting..." : "Delete Snapshot"}
              </button>
            </div>
        </SettingsModal>
      ) : null}

      {importBackup ? (
        <SettingsModal
          title="Restore Snapshot"
          onClose={() => {
            setImportBackup(null);
            setImportBackupProjectName("");
          }}
          closeDisabled={backupBusy === "import"}
        >
            <div className="app-settings-modal-body">
              <p className="import-project-copy">
                Restore the snapshot from {formatPostgresDateTime(importBackup.createdAt)} as a new project.
              </p>
              <label className="form-field">
                <span>New project name</span>
                <input
                  className="form-input"
                  value={importBackupProjectName}
                  onChange={(event) => setImportBackupProjectName(event.target.value)}
                  disabled={backupBusy === "import"}
                  autoFocus
                />
              </label>
              <div className="home-restricted-list">
                <div className="home-restricted-item"><span className="home-restricted-label">Database</span><span className="home-restricted-value">{formatPostgresBackupSize(importBackup.databaseBytes) || "0 B"}</span></div>
                <div className="home-restricted-item"><span className="home-restricted-label">Files</span><span className="home-restricted-value">{formatPostgresBackupSize(importBackup.storageBytes) || "0 B"}</span></div>
                <div className="home-restricted-item"><span className="home-restricted-label">Stored files</span><span className="home-restricted-value">{importBackup.storageFileCount}</span></div>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <button type="button" className="btn" onClick={() => {
                setImportBackup(null);
                setImportBackupProjectName("");
              }} disabled={backupBusy === "import"}>Cancel</button>
              <button type="button" className="btn btn--primary" onClick={() => void handleImportBackup()} disabled={backupBusy === "import" || !canManageProject || !importBackupProjectName.trim()}>
                {backupBusy === "import" ? "Restoring..." : "Restore"}
              </button>
            </div>
        </SettingsModal>
      ) : null}

      {importedBackupProject ? (
        <SettingsModal title="Snapshot Restored" onClose={() => setImportedBackupProject(null)}>
            <div className="app-settings-modal-body">
              <p className="import-project-copy">
                Created "{importedBackupProject.name}" as a new project.
              </p>
            </div>
            <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
              {onProjectOpened ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const projectToOpen = importedBackupProject;
                    setImportedBackupProject(null);
                    void onProjectOpened(projectToOpen);
                  }}
                >
                  Open Project
                </button>
              ) : null}
              <button type="button" className="btn btn--primary" onClick={() => setImportedBackupProject(null)}>Done</button>
            </div>
        </SettingsModal>
      ) : null}

      {codebookImportResult ? (
        <SettingsModal title="Codebook Imported" onClose={() => setCodebookImportResult(null)}>
            <div className="app-settings-modal-body">
              <p className="import-project-copy">
                Imported {codebookImportResult.importedCount} codes.
              </p>
            </div>
            <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
              <button type="button" className="btn btn--primary" onClick={() => setCodebookImportResult(null)}>Done</button>
            </div>
        </SettingsModal>
      ) : null}
    </div>
  );
}


export function PostgresAppSettingsView({
  authSession,
  project,
  canManageProject = false,
  canEditProjectMetadata = canManageProject,
  memberCount = 0,
  ownerCount = 0,
  objectCount = 0,
  relationshipCount = 0,
  onProjectUpdated,
  onProjectDeleted,
  onProjectOpened,
  onAuthSessionUpdated,
  onAuthSessionInvalidated,
}: PostgresAppSettingsViewProps) {
  const { locale, setLocale, t } = useI18n();
  const [activeModal, setActiveModal] = useState<AppSettingsModalId | null>(null);
  const [showThemeManager, setShowThemeManager] = useState(false);
  const [appInfo, setAppInfo] = useState<AppRuntimeInfo | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [theme, setTheme] = useState<Theme>("light");
  const [density, setDensity] = useState<Density>("comfortable");
  const [fontSize, setFontSize] = useState<FontSize>("normal");
  const [sourceTextSizePx, setSourceTextSizePx] = useState(15);
  const [recentProjectLimit, setRecentProjectLimit] = useState(10);
  const permissionMatrixRows = useMemo(() => buildPermissionMatrixRows(t), [t]);

  const refreshDetails = useCallback(async () => {
    setError("");
    try {
      const [nextUserPreferences, nextAppInfo] = await Promise.all([
        getPostgresUserPreferences(),
        getAppRuntimeInfo(),
      ]);
      setAppInfo(nextAppInfo);
      setTheme(nextUserPreferences.theme);
      setDensity(nextUserPreferences.density);
      setFontSize(nextUserPreferences.fontSize);
      setSourceTextSizePx(nextUserPreferences.sourceTextSizePx);
      setRecentProjectLimit(nextUserPreferences.recentProjectLimit);
      if (nextUserPreferences.locale !== locale) setLocale(nextUserPreferences.locale);
      applyPostgresRuntimeThemePreferences(nextUserPreferences);
      setActivePresetId(null);
    } catch (loadError) {
      setError(describeAppSettingsUnknownError(loadError));
    }
  }, [locale, setLocale]);

  useEffect(() => {
    void refreshDetails();
  }, [refreshDetails]);

  const persistUserPreferences = useCallback(async (next: PostgresUserPreferences, successMessage?: string) => {
    try {
      const saved = await savePostgresUserPreferences(next);
      setTheme(saved.theme);
      setDensity(saved.density);
      setFontSize(saved.fontSize);
      setSourceTextSizePx(saved.sourceTextSizePx);
      setRecentProjectLimit(saved.recentProjectLimit);
      applyPostgresRuntimeThemePreferences(saved);
      if (successMessage) setNotice(successMessage);
      setError("");
    } catch (saveError) {
      setError(describeAppSettingsUnknownError(saveError));
    }
  }, []);

  function persistThemePatch(next: Partial<Pick<PostgresUserPreferences, "theme" | "density" | "fontSize" | "locale">>) {
    void persistUserPreferences({
      theme,
      density,
      fontSize,
      sourceTextSizePx,
      locale,
      recentProjectLimit,
      themeState: getStoredThemeState(),
      ...next,
    });
  }

  async function handleLocaleChange(nextLocale: (typeof SUPPORTED_LOCALES)[number]) {
    setLocale(nextLocale);
    await persistUserPreferences({
      theme,
        density,
        fontSize,
        sourceTextSizePx,
        locale: nextLocale,
      recentProjectLimit,
      themeState: getStoredThemeState(),
    }, "Language updated.");
  }

  async function handleThemeManagerApplied() {
    const nextTheme = getStoredTheme();
    setTheme(nextTheme);
    await persistUserPreferences({
      theme: nextTheme,
      density,
      fontSize,
      sourceTextSizePx,
      locale,
      recentProjectLimit,
      themeState: getStoredThemeState(),
    }, "Theme updated.");
  }

  const groupedCards = [
    {
      id: "preferences",
      title: "Preferences",
      cards: [
        { id: "appearance", title: "Appearance", icon: "Aa" },
        { id: "language", title: t("appSettings.sectionTitles.language"), icon: "LA" },
      ] as Array<{ id: AppSettingsModalId; title: string; icon: string }>,
    },
    {
      id: "system",
      title: "System",
      cards: [
        { id: "about", title: t("appSettings.about.title"), icon: "KQ" },
        { id: "permissions", title: t("appSettings.permissions.title"), icon: "RO" },
      ] as Array<{ id: AppSettingsModalId; title: string; icon: string }>,
    },
  ];

  return (
    <div className="view app-settings-view app-settings-view--compact">
      <header className="view-header">
        <div className="view-title-with-help">
          <h1>Settings</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            onClick={() => setHelpOpen(true)}
            title="Open settings help"
            aria-label="Open settings help"
          >
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
      </header>

      {helpOpen ? (
        <SettingsModal title="Settings Help" onClose={() => setHelpOpen(false)} modalClassName="modal--help">
          <div className="app-settings-modal-body">
            <p className="users-guide-copy">
              Manage project details, storage, snapshots, imports and exports, codebook transfer, permissions, and personal display preferences from this settings hub.
            </p>
            <p className="users-guide-copy">
              Some settings affect only your signed-in user, while project administration actions depend on your project role.
            </p>
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
              Close
            </button>
          </div>
        </SettingsModal>
      ) : null}

      {notice ? <p className="settings-success">{notice}</p> : null}
      {error ? <p className="auth-error">{error}</p> : null}

      <div className="app-settings-overview-shell">
        <div className="app-settings-overview-stack app-settings-overview-stack--compact">
          {onAuthSessionUpdated && onAuthSessionInvalidated ? (
            <section className="app-settings-overview-section app-settings-overview-section--compact">
              <div className="app-settings-overview-section-header">
                <p className="app-settings-overview-section-heading">Account</p>
              </div>
              <PostgresUserSettingsView
                authSession={authSession}
                onAuthSessionUpdated={onAuthSessionUpdated}
                onAuthSessionInvalidated={onAuthSessionInvalidated}
                embedded
                includeAppearance={false}
              />
            </section>
          ) : null}

          {project && onProjectUpdated && onProjectDeleted ? (
            <section className="app-settings-overview-section app-settings-overview-section--compact">
              <div className="app-settings-overview-section-header">
                <p className="app-settings-overview-section-heading">Project</p>
              </div>
              <EmbeddedPostgresProjectSettings
                project={project}
                canManageProject={canManageProject}
                canEditProjectMetadata={canEditProjectMetadata}
                memberCount={memberCount}
                ownerCount={ownerCount}
                objectCount={objectCount}
                relationshipCount={relationshipCount}
                onProjectUpdated={onProjectUpdated}
                onProjectDeleted={onProjectDeleted}
                onProjectOpened={onProjectOpened}
                embedded
              />
            </section>
          ) : null}

          <div className="app-settings-overview-sections">
            {groupedCards.map((section) => (
              <section key={section.id} className="app-settings-overview-section app-settings-overview-section--compact">
                <div className="app-settings-overview-section-header">
                  <p className="app-settings-overview-section-heading">{section.title}</p>
                </div>
                <div className="app-settings-overview-grid app-settings-overview-grid--compact">
                  {section.cards.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      className="app-settings-overview-card app-settings-overview-card--compact app-settings-overview-card--default"
                      onClick={() => setActiveModal(card.id)}
                    >
                      <span className="app-settings-overview-card-icon" aria-hidden="true">{card.icon}</span>
                      <h3>{card.title}</h3>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>

      {activeModal === "about" ? (
        <SettingsModal title={t("appSettings.about.title")} onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              <div className="app-settings-about-body">
                <section className="about-kanqual-section">
                  <h4>{t("appSettings.about.release")}</h4>
                  <div className="about-kanqual-meta-grid">
                    <div className="about-kanqual-meta-card">
                      <span className="about-kanqual-meta-label">{t("appSettings.about.version")}</span>
                      <strong>{appInfo?.appVersion ?? "0.9.1"}</strong>
                    </div>
                    <div className="about-kanqual-meta-card">
                      <span className="about-kanqual-meta-label">{t("appSettings.about.releaseDate")}</span>
                      <strong>{RELEASE_DATE}</strong>
                    </div>
                  </div>
                </section>

                <hr className="about-kanqual-separator" />

                <section className="about-kanqual-section">
                  <h4>{t("appSettings.about.createdBy")}</h4>
                  <p>{t("appSettings.about.createdByBody")}</p>
                </section>

                <hr className="about-kanqual-separator" />

                <section className="about-kanqual-section">
                  <h4>{t("appSettings.about.citation")}</h4>
                  <p>{t("appSettings.about.citationNote")}</p>
                  <div className="about-kanqual-citation">
                    {t("appSettings.about.citationExample", {
                      version: appInfo?.appVersion ?? "0.9.1",
                    })}
                  </div>
                </section>

                <hr className="about-kanqual-separator" />

                <section className="about-kanqual-section">
                  <h4>{t("appSettings.about.license")}</h4>
                  <p>{t("appSettings.about.licenseBody")} {t("appSettings.about.licenseNote")}</p>
                </section>

                <hr className="about-kanqual-separator" />

                <section className="about-kanqual-section">
                  <h4>{t("appSettings.about.dependencyLicenses")}</h4>
                  <p className="about-kanqual-license-note">{t("appSettings.about.dependencyLicensesNote")}</p>

                  <div className="about-kanqual-license-block">
                    <h5>{t("appSettings.about.javascriptTypescript")}</h5>
                    <div className="about-kanqual-license-table-wrap">
                      <table className="about-kanqual-license-table">
                        <thead>
                          <tr>
                            <th>{t("appSettings.about.package")}</th>
                            <th>{t("appSettings.about.version")}</th>
                            <th>{t("appSettings.about.license")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {aboutJavascriptLicenses.map((row) => (
                            <tr key={`js-${row.name}-${row.version}`}>
                              <td>{row.name}</td>
                              <td>{row.version}</td>
                              <td>{row.license}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="about-kanqual-license-block">
                    <h5>{t("appSettings.about.rust")}</h5>
                    <div className="about-kanqual-license-table-wrap">
                      <table className="about-kanqual-license-table">
                        <thead>
                          <tr>
                            <th>{t("appSettings.about.crate")}</th>
                            <th>{t("appSettings.about.version")}</th>
                            <th>{t("appSettings.about.license")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {aboutRustLicenses.map((row) => (
                            <tr key={`rust-${row.name}-${row.version}`}>
                              <td>{row.name}</td>
                              <td>{row.version}</td>
                              <td>{row.license}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer"><span /><button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button></div>
        </SettingsModal>
      ) : null}

      {activeModal === "appearance" ? (
        <SettingsModal title="Appearance" onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <SettingsModalSection title="Interface">
                  <ActiveThemePreviewRow theme={theme} onEdit={() => setShowThemeManager(true)} />
                  <div className="settings-row">
                    <div className="settings-row-info"><div className="settings-row-label">Interface density</div></div>
                    <div className="segmented-control">
                      {(["comfortable", "compact"] as Density[]).map((option) => (
                        <button
                          key={option}
                          type="button"
                          className={density === option ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                          onClick={() => {
                            setDensity(option);
                            applyDensity(option);
                            persistThemePatch({ density: option });
                          }}
                        >
                          {option === "comfortable" ? "Comfortable" : "Compact"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-info"><div className="settings-row-label">Text size</div></div>
                    <div className="segmented-control">
                      {(["small", "normal", "large"] as FontSize[]).map((option) => (
                        <button
                          key={option}
                          type="button"
                          className={fontSize === option ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                          onClick={() => {
                            setFontSize(option);
                            applyFontSize(option);
                            persistThemePatch({ fontSize: option });
                          }}
                        >
                          {option === "small" ? "Small" : option === "normal" ? "Normal" : "Large"}
                        </button>
                      ))}
                    </div>
                  </div>
                </SettingsModalSection>
              </div>
            </div>
            <div className="app-settings-modal-footer"><span /><button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button></div>
        </SettingsModal>
      ) : null}

      {activeModal === "language" ? (
        <LanguageSettingsModal
          title={t("appSettings.sectionTitles.language")}
          label={t("appSettings.language.label")}
          locale={locale}
          onChange={(nextLocale) => void handleLocaleChange(nextLocale)}
          onClose={() => setActiveModal(null)}
        />
      ) : null}

      {activeModal === "permissions" ? (
        <SettingsModal title={t("appSettings.permissions.title")} onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              <SettingsModalSection title="User Roles">
                <div className="users-table-wrap postgres-users-table-wrap" style={{ maxHeight: 420 }}>
                  <table className="users-table">
                    <thead>
                      <tr>
                        <th className="users-th">Area</th>
                        <th className="users-th">Action</th>
                        <th className="users-th">Owner</th>
                        <th className="users-th">Editor</th>
                        <th className="users-th">Viewer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {permissionMatrixRows.map((row) => (
                        <tr className="users-row" key={`${row.category}-${row.permission}`}>
                          <td className="users-td users-td--muted">{row.category}</td>
                          <td className="users-td users-td--name">{row.permission}</td>
                          <td className="users-td">{row.owner ? "Yes" : "No"}</td>
                          <td className="users-td">{row.editor ? "Yes" : "No"}</td>
                          <td className="users-td">{row.viewer ? "Yes" : "No"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SettingsModalSection>
            </div>
            <div className="app-settings-modal-footer"><span /><button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button></div>
        </SettingsModal>
      ) : null}

      {showThemeManager ? (
        <ThemeManagerModal
          onClose={() => setShowThemeManager(false)}
          onApplied={() => void handleThemeManagerApplied()}
          onCanceled={() => setTheme(getStoredTheme())}
        />
      ) : null}
    </div>
  );
}
