import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { useStore } from "../context/StoreContext";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import {
  backupDisplayReason,
  backupRetentionStatus,
  createProjectBackup,
  DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES,
  DEFAULT_BACKUP_RETENTION,
  deleteManualProjectBackup,
  formatBackupSize,
  loadProjectBackupManifest,
  readProjectBackup,
  saveProjectBackupSettings,
  type BackupRetentionSettings,
  type BackupRetentionStatus,
  type ProjectBackupEntry,
  type ProjectBackupManifest,
} from "../lib/projectBackups";
import {
  fetchProjectExportData,
  importProjectBackupIntoProject,
  importRefiQdaCodebookIntoProject,
  makeProjectBackupJson,
  makeProjectBackupXlsx,
  makeRefiQdaCodebook,
  makeRefiQdaProject,
  parseRefiQdaCodebook,
} from "../lib/projectExport";
import { hasHtmlText } from "../lib/htmlText";
import {
  loadProjectBackupPolicy,
  type ProjectDocumentImportSettings,
  type ProjectAiAssistSettings,
} from "../lib/projectSettings";
import {
  buildProjectEmbeddingItems,
  type ProjectEmbeddingBuildPreflight,
  type ProjectEmbeddingIndexStatus,
} from "../lib/projectEmbeddings";
import { readAppSettings } from "../lib/appSettings";
import {
  formatProjectLogDateTime,
  projectLogAccessModeLabel,
  projectLogActionCategory,
  ProjectLogTable,
  PROJECT_LOG_ACTION_LABELS,
} from "./Project_Log_View";
import type { PendingImportedUser, Project, ProjectLogEntry, ProjectUploadedFile } from "../types";
import { PROJECT_UPLOADED_FILES_COLLECTION } from "../lib/projectUploadedFiles";
import { HelpIcon } from "../components/AppIcons";

const RTE_TOOLS: { cmd: string; label: string; title: string }[] = [
  { cmd: "bold", label: "B", title: "Bold" },
  { cmd: "italic", label: "I", title: "Italic" },
  { cmd: "underline", label: "U", title: "Underline" },
  { cmd: "insertUnorderedList", label: "UL", title: "Bullet list" },
  { cmd: "insertOrderedList", label: "1.", title: "Numbered list" },
];

type SettingsModalSectionProps = {
  title: string;
  description: ReactNode;
  children?: ReactNode;
  tone?: "default" | "warning" | "danger";
};

function SettingsModalSection({
  title,
  description,
  children,
  tone = "default",
}: SettingsModalSectionProps) {
  return (
    <section className="app-settings-modal-section">
      <div className={`app-settings-modal-section-header app-settings-modal-section-header--${tone}`}>
        <h3>{title}</h3>
        <div className="app-settings-modal-section-description">{description}</div>
      </div>
      {children ? <div className="app-settings-modal-section-body">{children}</div> : null}
    </section>
  );
}

function shouldShowProjectAutoSaveNotice(sectionId: string) {
  return ["ai-assist", "document-import"].includes(sectionId);
}

function restoredUserNotice(summary: {
  importedUsers: Array<{ email: string; temporaryPassword?: string; created: boolean }>;
}): string | null {
  const createdUsers = summary.importedUsers.filter((user) => user.created);
  if (createdUsers.length === 0) return null;
  return [
    "Restored user accounts created:",
    ...createdUsers.map((user) => `${user.email} - password: ${user.temporaryPassword ?? "(set in backup)"}`),
  ].join("\n");
}
void restoredUserNotice;

function mismatchNotes(summary: {
  identityChecks: { backendMatched: boolean; usersTableMatched: boolean; allUsersPresent: boolean };
}): string[] {
  const notes: string[] = [];
  if (!summary.identityChecks.backendMatched) {
    notes.push("It appears to be a new instance of Kanqual.");
  } else if (!summary.identityChecks.usersTableMatched) {
    notes.push("The users table identifier does not match this instance. It appears the users table was recreated from scratch.");
  } else if (!summary.identityChecks.allUsersPresent) {
    notes.push("One or more users from the restored project do not exist in the current users table.");
  }
  notes.push("In the next screen, you will need to configure what to do with the associated user accounts.");
  return notes;
}

function RichTextEditor({
  initialHtml,
  editorRef,
}: {
  initialHtml: string;
  editorRef: React.RefObject<HTMLDivElement | null>;
}) {
  const id = useId();

  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = initialHtml;
  }, [editorRef, initialHtml]);

  function execCmd(cmd: string) {
    document.getElementById(id)?.focus();
    document.execCommand(cmd, false);
  }

  return (
    <div className="rte project-details-rte">
      <div className="rte-toolbar">
        {RTE_TOOLS.map((tool) => (
          <button
            key={tool.cmd}
            type="button"
            className="rte-btn"
            title={tool.title}
            onMouseDown={(event) => {
              event.preventDefault();
              execCmd(tool.cmd);
            }}
          >
            {tool.label}
          </button>
        ))}
      </div>
      <div
        id={id}
        ref={editorRef}
        className="rte-content project-details-rte-content"
        contentEditable
        suppressContentEditableWarning
      />
    </div>
  );
}

function safeExportName(name: string): string {
  return name.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "Kanqual_Project";
}

function restoredProjectName(projectName: string, projects: Project[]): string {
  const stamp = new Date()
    .toLocaleString([], {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    .replace(/[^\d]+/g, "-")
    .replace(/^-|-$/g, "");
  const base = `${projectName.trim() || "Restored Project"} Restored ${stamp}`;
  if (!projects.some((project) => project.name.trim().toLowerCase() === base.toLowerCase())) return base;
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

function formatBackupDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatBackupDay(date: Date): string {
  return date.toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatBackupHour(date: Date): string {
  return `${date.toLocaleTimeString([], { hour: "numeric" })} on ${formatBackupDay(date)}`;
}

function backupRetentionLabels(status: BackupRetentionStatus): string[] {
  const labels: string[] = [];
  if (status.category === "latest") {
    labels.push("Latest automatic backup");
  } else if (status.category === "hourly" && status.bucketStart) {
    labels.push(`Hourly backup for ${formatBackupHour(status.bucketStart)}`);
  } else if (status.category === "daily" && status.bucketStart) {
    labels.push(`Daily backup for ${formatBackupDay(status.bucketStart)}`);
  } else if (status.category === "weekly" && status.bucketStart) {
    labels.push(`Weekly backup for week of ${formatBackupDay(status.bucketStart)}`);
  } else if (status.category === "pending-delete") {
    labels.push("Deletes on next cleanup");
  }

  if (status.promotion) {
    labels.push(`Will become the ${status.promotion} backup`);
  } else if (
    status.category !== "pending-delete" &&
    status.deletionDate &&
    status.deletionDate.getTime() > Date.now()
  ) {
    labels.push(`Retained until ${formatBackupDay(status.deletionDate)}`);
  }
  return labels;
}

function backupTriggerLabel(backup: ProjectBackupEntry, logEntries: ProjectLogEntry[]): string {
  if (backup.manual) return "";
  if (backup.sourceLogLabel) return backup.sourceLogLabel;
  const logEntry = logEntries.find((entry) => entry.occurredAt === backup.sourceLogAt);
  if (logEntry?.label) return logEntry.label;
  if (backup.reason === "session") return "Project session changed";
  return "Scheduled automatic backup";
}

type EmbeddingModelStatus = {
  installed: boolean;
  repoId: string;
  displayName: string;
  modelDir: string;
  files: number;
  bytes: number;
  downloadedAtMs: number | null;
};

function formatEstimateRange(lowSeconds: number | null, highSeconds: number | null): string {
  if (lowSeconds == null || highSeconds == null) return "Estimating based on this device...";
  const lowMinutes = Math.max(1, Math.ceil(lowSeconds / 60));
  const highMinutes = Math.max(lowMinutes, Math.ceil(highSeconds / 60));
  return lowMinutes === highMinutes ? `Around ${lowMinutes} minute${lowMinutes === 1 ? "" : "s"}` : `Around ${lowMinutes}-${highMinutes} minutes`;
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

function csvEscape(value: string): string {
  const normalized = value.replace(/\r?\n/g, " ");
  if (/[",]/.test(normalized)) {
    return `"${normalized.replace(/"/g, "\"\"")}"`;
  }
  return normalized;
}

export function ProjectSettingsView() {
  const {
    pb,
    activeProject,
    canCurrentUser,
    setView,
    logAction,
    ensureProjectSafetyBackup,
    updateProject,
    projects,
    documents,
    projectUploadedFiles,
    cases,
    codes,
    annotations,
    memos,
    createProject,
    openProject,
    openProjectToView,
    logEntries,
    setPendingImportedUserResolution,
    projectEmbeddingBuildStatus,
    projectAiAssistSettings,
    projectAiAssistRuntimeStatus,
    projectDocumentImportSettings,
    updateProjectAiAssistSettings,
    updateProjectDocumentImportSettings,
    startProjectEmbeddingBuild,
    deleteProjectUploadedFile,
    isLocalWorkspace,
  } = useStore();
  const [exporting, setExporting] = useState<"json" | "xlsx" | "qdpx" | "encrypted" | null>(null);
  const [projectLogExporting, setProjectLogExporting] = useState(false);
  const [codebookBusy, setCodebookBusy] = useState<"export" | "import" | null>(null);
  const [activeProjectSettingsModal, setActiveProjectSettingsModal] = useState<string | null>(null);
  const [exportError, setExportError] = useState("");
  const [encryptedBackupPassword, setEncryptedBackupPassword] = useState("");
  const [encryptedBackupPasswordConfirm, setEncryptedBackupPasswordConfirm] = useState("");
  const [codebookError, setCodebookError] = useState("");
  const [codebookImportResult, setCodebookImportResult] = useState<{ importedCount: number } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsName, setDetailsName] = useState("");
  const [detailsDescription, setDetailsDescription] = useState("");
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const detailsDescriptionRef = useRef<HTMLDivElement | null>(null);
  const [backupManifest, setBackupManifest] = useState<ProjectBackupManifest | null>(null);
  const [backupBusy, setBackupBusy] = useState<"manual" | "settings" | "restore" | "delete" | null>(null);
  const [backupError, setBackupError] = useState("");
  const [backupNotice, setBackupNotice] = useState("");
  const [retentionDraft, setRetentionDraft] = useState<BackupRetentionSettings>(DEFAULT_BACKUP_RETENTION);
  const [automaticIntervalDraft, setAutomaticIntervalDraft] = useState(DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES);
  const [backupStatusNow, setBackupStatusNow] = useState(() => new Date());
  const [restoreBackup, setRestoreBackup] = useState<ProjectBackupEntry | null>(null);
  const [restoreCompleteProject, setRestoreCompleteProject] = useState<Project | null>(null);
  const [restoreResolutionIntro, setRestoreResolutionIntro] = useState<{
    project: Project;
    users: PendingImportedUser[];
    notes: string[];
  } | null>(null);
  const [deleteBackup, setDeleteBackup] = useState<ProjectBackupEntry | null>(null);
  const [backupContextMenu, setBackupContextMenu] = useState<{ x: number; y: number; backup: ProjectBackupEntry } | null>(null);
  const backupContextMenuRef = useRef<HTMLDivElement | null>(null);
  const backupContextMenuStyle = useViewportContextMenuStyle(backupContextMenu, backupContextMenuRef);
  const [aiAssistNotice, setAiAssistNotice] = useState("");
  const [aiAssistError, setAiAssistError] = useState("");
  const [documentImportNotice, setDocumentImportNotice] = useState("");
  const [documentImportError, setDocumentImportError] = useState("");
  const [aiAssistIndexStatus, setAiAssistIndexStatus] = useState<ProjectEmbeddingIndexStatus | null>(null);
  const [aiAssistBuildPreflight, setAiAssistBuildPreflight] = useState<ProjectEmbeddingBuildPreflight | null>(null);
  const [aiAssistDeletingIndex, setAiAssistDeletingIndex] = useState(false);
  const [aiAssistRequirementOpen, setAiAssistRequirementOpen] = useState(false);
  const [aiAssistBuildOpen, setAiAssistBuildOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [uploadedFilesNotice, setUploadedFilesNotice] = useState("");
  const [uploadedFilesError, setUploadedFilesError] = useState("");
  const [uploadedFileDeleteTarget, setUploadedFileDeleteTarget] = useState<ProjectUploadedFile | null>(null);
  const [uploadedFileDeleteBusy, setUploadedFileDeleteBusy] = useState(false);
  const aiAssistBuildBusy =
    projectEmbeddingBuildStatus?.phase === "running" || projectEmbeddingBuildStatus?.phase === "cancelling";
  const canEditProjectMetadata = canCurrentUser("editProjectMetadata");
  const canExportProject = canCurrentUser("exportProject");
  const canRestoreProjectBackup = canCurrentUser("restoreProjectBackup");
  const canManageBackups = canCurrentUser("manageBackupsAndRestores");
  const canEnableProjectAiAssist = canCurrentUser("enableProjectAiAssist");
  const canBuildProjectEmbeddings = canCurrentUser("buildEmbeddings");
  const canDeleteProjectEmbeddings = canCurrentUser("deleteEmbeddings");
  const canManageProjectAiAssist =
    canEnableProjectAiAssist
    || canBuildProjectEmbeddings
    || canDeleteProjectEmbeddings;
  const canExchangeCodebook =
    canCurrentUser("createCode") || canCurrentUser("editCode") || canExportProject;
  const canManageUploadedFiles = canCurrentUser("manageProjectUploadedFiles");
  const canAccessProjectSettings =
    canEditProjectMetadata
    || canExportProject
    || canRestoreProjectBackup
    || canManageBackups
    || canManageProjectAiAssist
    || canManageUploadedFiles
    || canExchangeCodebook;

  const visibleUploadedFiles = projectUploadedFiles
    .filter((file) => file.status !== "deleted")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

  function uploadedFileUrl(file: ProjectUploadedFile): string {
    return `${pb.baseURL}/api/files/${PROJECT_UPLOADED_FILES_COLLECTION}/${file.id}/${file.uploadedFile}`;
  }

  async function handleDeleteUploadedFile() {
    if (!uploadedFileDeleteTarget) return;
    setUploadedFilesError("");
    setUploadedFilesNotice("");
    setUploadedFileDeleteBusy(true);
    try {
      await deleteProjectUploadedFile(uploadedFileDeleteTarget.id, uploadedFileDeleteTarget.originalFileName);
      setUploadedFilesNotice(`Deleted retained source file "${uploadedFileDeleteTarget.originalFileName}".`);
      setUploadedFileDeleteTarget(null);
    } catch (error) {
      console.error("Failed to delete retained source file:", error);
      setUploadedFilesError("Could not delete the retained source file.");
    } finally {
      setUploadedFileDeleteBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    if (!activeProject || !canManageBackups) {
      setBackupManifest(null);
      return;
    }
    Promise.all([
      loadProjectBackupManifest(activeProject),
      loadProjectBackupPolicy(pb, activeProject.id, {
        retention: DEFAULT_BACKUP_RETENTION,
        automaticIntervalMinutes: DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES,
      }),
    ])
      .then(([manifest, backupPolicy]) => {
        if (cancelled) return;
        const mergedManifest = {
          ...manifest,
          retention: backupPolicy.retention,
          automaticIntervalMinutes: backupPolicy.automaticIntervalMinutes,
        };
        setBackupManifest(mergedManifest);
        setRetentionDraft(backupPolicy.retention);
        setAutomaticIntervalDraft(backupPolicy.automaticIntervalMinutes);
      })
      .catch((error) => {
        console.error("Failed to load project backups:", error);
        if (!cancelled) setBackupError("Could not load project backups.");
      });
    return () => {
      cancelled = true;
    };
  }, [activeProject?.id, canManageBackups, pb]);

  useEffect(() => {
    if (!activeProject || !canManageProjectAiAssist) {
      setAiAssistNotice("");
      setAiAssistError("");
      setAiAssistIndexStatus(null);
      setAiAssistDeletingIndex(false);
      setAiAssistBuildOpen(false);
      return;
    }
    setAiAssistNotice("");
    setAiAssistError("");
    setAiAssistDeletingIndex(false);
    setAiAssistBuildOpen(false);
  }, [activeProject?.id, canManageProjectAiAssist]);

  useEffect(() => {
    if (!activeProject || !canManageProjectAiAssist) return;
    if (!isLocalWorkspace) {
      setAiAssistIndexStatus({
        exists: projectAiAssistRuntimeStatus.hostProjectEmbeddingsReady === true,
        generatedAtMs: null,
        itemCount: 0,
        modelRepoId: null,
        modelDisplayName: null,
      });
      return;
    }
    let cancelled = false;
    void invoke<ProjectEmbeddingIndexStatus>("get_project_embedding_index_status", {
      projectId: activeProject.id,
    })
      .then((status) => {
        if (!cancelled) setAiAssistIndexStatus(status);
      })
      .catch((error) => {
        console.error("Failed to load project embedding index status:", error);
        if (!cancelled) setAiAssistIndexStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeProject?.id,
    canManageProjectAiAssist,
    isLocalWorkspace,
    projectAiAssistRuntimeStatus.hostProjectEmbeddingsReady,
    projectEmbeddingBuildStatus?.phase,
  ]);

  useEffect(() => {
    if (!activeProject || !canManageProjectAiAssist) {
      setAiAssistBuildPreflight(null);
      return;
    }
    if (!isLocalWorkspace) {
      setAiAssistBuildPreflight(null);
      return;
    }
    let cancelled = false;
    const appSettings = readAppSettings();
    const items = buildProjectEmbeddingItems(documents, cases, codes, annotations, memos, appSettings.llm);
    void invoke<ProjectEmbeddingBuildPreflight>("get_project_embedding_build_preflight", {
      request: {
        projectId: activeProject.id,
        batchSize: appSettings.llm.batchSize,
        chunkSize: appSettings.llm.chunkSize,
        overlapSize: appSettings.llm.overlapSize,
        prefixPassages: appSettings.llm.prefixPassages,
        normalizeWhitespace: appSettings.llm.normalizeWhitespace,
        items,
      },
    })
      .then((preflight) => {
        if (!cancelled) setAiAssistBuildPreflight(preflight);
      })
      .catch((error) => {
        console.error("Failed to load project embedding build preflight:", error);
        if (!cancelled) setAiAssistBuildPreflight(null);
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeProject?.id,
    canManageProjectAiAssist,
    documents,
    cases,
    codes,
    annotations,
    memos,
    isLocalWorkspace,
    projectEmbeddingBuildStatus?.phase,
  ]);

  useEffect(() => {
    const requestedModal = sessionStorage.getItem("kanqual:open-project-settings-modal");
    if (!requestedModal) return;
    sessionStorage.removeItem("kanqual:open-project-settings-modal");
    setActiveProjectSettingsModal(requestedModal);
  }, []);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (backupContextMenuRef.current && !backupContextMenuRef.current.contains(e.target as Node)) {
        setBackupContextMenu(null);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setBackupContextMenu(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (activeProjectSettingsModal !== "backups") return;
    setBackupStatusNow(new Date());
    const interval = window.setInterval(() => {
      setBackupStatusNow(new Date());
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [activeProjectSettingsModal]);

  function openDetailsModal() {
    if (!activeProject || !canEditProjectMetadata) return;
    setDetailsName(activeProject.name);
    setDetailsDescription(activeProject.description);
    setDetailsError("");
    setDetailsOpen(true);
  }

  async function handleDetailsSave(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeProject || !detailsName.trim() || !canEditProjectMetadata) return;
    setDetailsSaving(true);
    setDetailsError("");
    try {
      const descriptionHtml = detailsDescriptionRef.current?.innerHTML ?? detailsDescription;
      await updateProject(activeProject.id, {
        name: detailsName.trim(),
        description: hasHtmlText(descriptionHtml) ? descriptionHtml.trim() : "",
      });
      setDetailsOpen(false);
    } catch (error) {
      console.error("Project details update failed:", error);
      setDetailsError(error instanceof Error ? error.message : "Project details update failed. Please try again.");
    } finally {
      setDetailsSaving(false);
    }
  }

  async function handleExport(format: "json" | "xlsx" | "qdpx") {
    if (!activeProject || !canExportProject) return;
    setExporting(format);
    setExportError("");
    try {
      const extension = format === "json" ? "json" : format === "xlsx" ? "xlsx" : "qdpx";
      const path = await save({
        defaultPath: `${safeExportName(activeProject.name)}_export.${extension}`,
        filters: [
          format === "json"
            ? { name: "Kanqual JSON Backup", extensions: ["json"] }
            : format === "xlsx"
              ? { name: "Excel Workbook", extensions: ["xlsx"] }
              : { name: "REFI-QDA Project", extensions: ["qdpx"] },
        ],
      });
      if (!path) return;

      const data = await fetchProjectExportData(pb, activeProject);
      if (format === "json") {
        await writeTextFile(path, makeProjectBackupJson(data));
      } else if (format === "xlsx") {
        await writeFile(path, makeProjectBackupXlsx(data));
      } else {
        await writeFile(path, makeRefiQdaProject(data));
      }
      await logAction(activeProject.id, "project.export", `Exported project as ${format.toUpperCase()}`);
      setActiveProjectSettingsModal(null);
    } catch (error) {
      console.error("Project export failed:", error);
      setExportError("Project export failed. Please try again.");
    } finally {
      setExporting(null);
    }
  }

  async function handleEncryptedBackupExport() {
    if (!activeProject || !canExportProject) return;
    if (!encryptedBackupPassword) {
      setExportError("Enter a password to export an encrypted backup.");
      return;
    }
    if (encryptedBackupPassword !== encryptedBackupPasswordConfirm) {
      setExportError("The encrypted backup passwords do not match.");
      return;
    }

    setExporting("encrypted");
    setExportError("");
    try {
      const path = await save({
        defaultPath: `${safeExportName(activeProject.name)}_encrypted_backup.kqbe`,
        filters: [{ name: "Kanqual Encrypted Backup", extensions: ["kqbe"] }],
      });
      if (!path) return;

      const data = await fetchProjectExportData(pb, activeProject);
      const backupJson = makeProjectBackupJson(data);
      const encryptedBackup = await invoke<string>("encrypt_project_backup", {
        request: {
          backupJson,
          password: encryptedBackupPassword,
        },
      });

      await writeTextFile(path, encryptedBackup);
      await logAction(activeProject.id, "project.encrypted_backup.export", "Exported encrypted project backup");
      setEncryptedBackupPassword("");
      setEncryptedBackupPasswordConfirm("");
      setActiveProjectSettingsModal(null);
    } catch (error) {
      console.error("Encrypted project backup export failed:", error);
      setExportError(error instanceof Error ? error.message : "Encrypted project backup export failed. Please try again.");
    } finally {
      setExporting(null);
    }
  }

  async function handleProjectLogExport() {
    if (!activeProject || projectLogExporting) return;
    setProjectLogExporting(true);
    setExportError("");
    try {
      const path = await save({
        defaultPath: `${safeExportName(activeProject.name)}_project_log.csv`,
        filters: [{ name: "CSV File", extensions: ["csv"] }],
      });
      if (!path) return;

      const sortedLogEntries = [...logEntries].sort(
        (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
      );

      const lines = [
        ["Time", "User", "Access", "Category", "Action", "Description"].join(","),
        ...sortedLogEntries.map((entry) =>
          [
            csvEscape(formatProjectLogDateTime(entry.occurredAt)),
            csvEscape(entry.userName || "-"),
            csvEscape(projectLogAccessModeLabel(entry.accessMode)),
            csvEscape(projectLogActionCategory(entry.action)),
            csvEscape(PROJECT_LOG_ACTION_LABELS[entry.action] ?? entry.action),
            csvEscape(entry.label),
          ].join(","),
        ),
      ];

      await writeTextFile(path, lines.join("\n"));
      await logAction(activeProject.id, "project.log.export", "Exported project log as CSV");
    } catch (error) {
      console.error("Project log export failed:", error);
      setExportError("Project log export failed. Please try again.");
    } finally {
      setProjectLogExporting(false);
    }
  }

  async function handleManualBackup() {
    if (!activeProject || !canManageBackups) return;
    setBackupBusy("manual");
    setBackupError("");
    setBackupNotice("");
    try {
      const { manifest } = await createProjectBackup(pb, activeProject, "manual", logEntries[0]?.occurredAt ?? "");
      setBackupManifest(manifest);
      await logAction(activeProject.id, "project.backup.create", "Created a manual project backup");
      setBackupNotice("Manual backup created. It will be retained indefinitely.");
    } catch (error) {
      console.error("Manual backup failed:", error);
      setBackupError(error instanceof Error ? error.message : "Manual backup failed. Please try again.");
    } finally {
      setBackupBusy(null);
    }
  }

  async function refreshBackupSettingsDrafts() {
    if (!activeProject || !canManageBackups) return;
    setBackupError("");
    try {
      const backupPolicy = await loadProjectBackupPolicy(pb, activeProject.id, {
        retention: retentionDraft,
        automaticIntervalMinutes: automaticIntervalDraft,
      });
      setRetentionDraft(backupPolicy.retention);
      setAutomaticIntervalDraft(backupPolicy.automaticIntervalMinutes);
    } catch (error) {
      console.error("Failed to load backup policy:", error);
      setBackupError("Could not load backup settings.");
    }
  }

  async function handleBackupSettingsSave(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeProject || !canManageBackups) return;
    setBackupBusy("settings");
    setBackupError("");
    setBackupNotice("");
    try {
      const manifest = await saveProjectBackupSettings(pb, activeProject, {
        retention: retentionDraft,
        automaticIntervalMinutes: automaticIntervalDraft,
      });
      setBackupManifest(manifest);
      await logAction(
        activeProject.id,
        "project.backup.settings",
        `Updated backup settings (interval ${automaticIntervalDraft} min, hourly ${retentionDraft.hourlyHours}h, daily ${retentionDraft.dailyDays}d, weekly ${retentionDraft.weeklyWeeks}w)`,
      );
      setBackupNotice("Backup settings saved.");
    } catch (error) {
      console.error("Backup settings update failed:", error);
      setBackupError("Could not save backup settings.");
    } finally {
      setBackupBusy(null);
    }
  }

  async function handleRestoreBackup() {
    if (!activeProject || !restoreBackup || !canRestoreProjectBackup) return;
    setBackupBusy("restore");
    setBackupError("");
    setBackupNotice("");
    try {
      const data = await readProjectBackup(activeProject, restoreBackup);
      const backupName = typeof data.project.name === "string" && data.project.name.trim()
        ? data.project.name.trim()
        : restoreBackup.projectName;
      const description = typeof data.project.description === "string" ? data.project.description : "";
      const project = await createProject(restoredProjectName(backupName, projects), description);
      const summary = await importProjectBackupIntoProject(pb, data, project.id);
      await logAction(project.id, "project.restore_backup", `Restored backup from ${formatBackupDate(restoreBackup.createdAt)}`);
      setRestoreBackup(null);
      if (summary.requiresUserResolution) {
        setRestoreResolutionIntro({
          project,
          users: summary.importedUsers,
          notes: mismatchNotes(summary),
        });
      } else {
        setRestoreCompleteProject(project);
      }
    } catch (error) {
      console.error("Backup restore failed:", error);
      setBackupError(error instanceof Error ? error.message : "Backup restore failed. Please try again.");
    } finally {
      setBackupBusy(null);
    }
  }

  async function handleDeleteManualBackup() {
    if (!activeProject || !deleteBackup || !canManageBackups) return;
    setBackupBusy("delete");
    setBackupError("");
    setBackupNotice("");
    try {
      const manifest = await deleteManualProjectBackup(activeProject, deleteBackup);
      setBackupManifest(manifest);
      await logAction(
        activeProject.id,
        "project.backup.delete",
        `Deleted manual backup from ${formatBackupDate(deleteBackup.createdAt)}`,
      );
      setDeleteBackup(null);
      setBackupNotice("Manual backup deleted.");
    } catch (error) {
      console.error("Manual backup delete failed:", error);
      setBackupError(error instanceof Error ? error.message : "Manual backup could not be deleted.");
    } finally {
      setBackupBusy(null);
    }
  }

  async function handleCodebookExport() {
    if (!activeProject || !canExchangeCodebook) return;
    setCodebookBusy("export");
    setCodebookError("");
    try {
      const path = await save({
        defaultPath: `${safeExportName(activeProject.name)}_codebook.qdc`,
        filters: [{ name: "REFI-QDA Codebook", extensions: ["qdc", "xml"] }],
      });
      if (!path) return;

      const data = await fetchProjectExportData(pb, activeProject);
      await writeTextFile(path, makeRefiQdaCodebook(data));
      await logAction(activeProject.id, "codebook.export", "Exported REFI-QDA codebook");
      setActiveProjectSettingsModal(null);
    } catch (error) {
      console.error("Codebook export failed:", error);
      setCodebookError("Codebook export failed. Please try again.");
    } finally {
      setCodebookBusy(null);
    }
  }

  async function handleCodebookImport() {
    if (!activeProject || !canExchangeCodebook) return;
    setCodebookBusy("import");
    setCodebookError("");
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "REFI-QDA Codebook", extensions: ["qdc", "xml"] }],
      });
      if (!selected || Array.isArray(selected)) return;

      await ensureProjectSafetyBackup("codebook.import", "Imported REFI-QDA codebook");
      const raw = await readTextFile(selected);
      const codes = parseRefiQdaCodebook(raw);
      const summary = await importRefiQdaCodebookIntoProject(pb, codes, activeProject.id);
      const importedCount = summary.tableCounts.codes ?? 0;
      await logAction(activeProject.id, "codebook.import", `Imported REFI-QDA codebook (${importedCount} codes)`);
      setCodebookImportResult({ importedCount });
      setActiveProjectSettingsModal(null);
    } catch (error) {
      console.error("Codebook import failed:", error);
      setCodebookError(error instanceof Error ? error.message : "Codebook import failed. Please try again.");
    } finally {
      setCodebookBusy(null);
    }
  }

  async function persistAiAssistSettings(nextSettings: ProjectAiAssistSettings, notice = "AI Assist settings saved.") {
    if (!activeProject || !canManageProjectAiAssist) return;
    await updateProjectAiAssistSettings(activeProject.id, nextSettings);
    setAiAssistNotice(notice);
    setAiAssistError("");
  }

  async function handleAiAssistEnabledChange(enabled: boolean) {
    if (!enabled) {
      await persistAiAssistSettings({ ...projectAiAssistSettings, enabled: false });
      if (activeProject) {
        await logAction(activeProject.id, "project.ai_assist.update", "Disabled AI Assist for this project");
      }
      return;
    }

    if (!activeProject || !canManageProjectAiAssist) return;
    const nextSettings = { ...projectAiAssistSettings, enabled: true };
    await persistAiAssistSettings(
      nextSettings,
      "AI Assist enabled. Finish the remaining setup steps to make all AI Assist tools ready.",
    );
    setAiAssistError("");
    await logAction(activeProject.id, "project.ai_assist.update", "Enabled AI Assist for this project");
    try {
      if (!isLocalWorkspace) {
        if (projectAiAssistRuntimeStatus.hostEmbeddingModelInstalled !== true) {
          setAiAssistRequirementOpen(true);
          return;
        }
        if (projectAiAssistRuntimeStatus.hostProjectEmbeddingsReady === true) {
          await persistAiAssistSettings(
            nextSettings,
            "AI Assist enabled. Existing host project embeddings will be reused.",
          );
          return;
        }

        setAiAssistBuildOpen(true);
        return;
      }

      const status = await invoke<EmbeddingModelStatus>("get_multilingual_e5_status");
      if (!status.installed) {
        setAiAssistRequirementOpen(true);
        return;
      }
      const indexStatus = await invoke<ProjectEmbeddingIndexStatus>("get_project_embedding_index_status", {
        projectId: activeProject.id,
      });
      if (indexStatus.exists) {
        setAiAssistIndexStatus(indexStatus);
        await persistAiAssistSettings(
          nextSettings,
          "AI Assist enabled. Existing local project embeddings will be reused.",
        );
        return;
      }

      const items = buildProjectEmbeddingItems(documents, cases, codes, annotations, memos);
      if (items.length === 0) {
        await persistAiAssistSettings(
          nextSettings,
          "AI Assist enabled. No project content was available to index yet.",
        );
        return;
      }

      setAiAssistBuildOpen(true);
    } catch (error) {
      console.error("Failed to verify embedding model status:", error);
      setAiAssistBuildOpen(false);
      setAiAssistError(error instanceof Error ? error.message : "Could not prepare AI Assist for this project.");
    }
  }

  async function handleAiAssistBuildRun() {
    if (!activeProject || !canManageProjectAiAssist) return;
    setAiAssistError("");
    try {
      if (!isLocalWorkspace) {
        if (projectAiAssistRuntimeStatus.hostEmbeddingModelInstalled !== true) {
          setAiAssistBuildOpen(false);
          setAiAssistRequirementOpen(true);
          return;
        }

        await startProjectEmbeddingBuild({
          projectId: activeProject.id,
          llmSettings: {
            batchSize: 0,
            chunkSize: 0,
            overlapSize: 0,
            prefixPassages: false,
            normalizeWhitespace: true,
          },
          items: [],
          successLog: {
            projectId: activeProject.id,
            action: "ai_assist.index",
            label: "Built host AI Assist embeddings",
          },
        });
        setAiAssistNotice("Host AI Assist is preparing in the background.");
        setAiAssistBuildOpen(false);
        return;
      }

      const modelStatus = await invoke<EmbeddingModelStatus>("get_multilingual_e5_status");
      if (!modelStatus.installed) {
        setAiAssistBuildOpen(false);
        setAiAssistRequirementOpen(true);
        return;
      }

      const appSettings = readAppSettings();
      const items = buildProjectEmbeddingItems(documents, cases, codes, annotations, memos, appSettings.llm);
      if (items.length === 0) {
        persistAiAssistSettings(
          { ...projectAiAssistSettings, enabled: true },
          "AI Assist enabled. No project content was available to index yet.",
        );
        setAiAssistBuildOpen(false);
        return;
      }

      await startProjectEmbeddingBuild({
        projectId: activeProject.id,
        llmSettings: appSettings.llm,
        items,
        successLog: {
          projectId: activeProject.id,
          action: "ai_assist.index",
          label: "Built local AI Assist embeddings",
        },
      });
      setAiAssistNotice("AI Assist is preparing in the background.");
      setAiAssistBuildOpen(false);
    } catch (error) {
      console.error("Failed to start AI Assist embedding build:", error);
      setAiAssistBuildOpen(false);
      setAiAssistError(error instanceof Error ? error.message : "Could not prepare AI Assist for this project.");
    }
  }

  async function handleDeleteAiAssistEmbeddings() {
    if (!activeProject || !canManageProjectAiAssist) return;
    setAiAssistDeletingIndex(true);
    setAiAssistError("");
    setAiAssistNotice("");
    try {
      const nextStatus = await invoke<ProjectEmbeddingIndexStatus>("delete_project_embedding_index", {
        authToken: pb.authStore.token,
        projectId: activeProject.id,
      });
      setAiAssistIndexStatus(nextStatus);
      const nextSettings = { ...projectAiAssistSettings, enabled: false };
      await updateProjectAiAssistSettings(activeProject.id, nextSettings);
      await logAction(
        activeProject.id,
        "project.ai_assist.embeddings.delete",
        "Deleted local AI Assist embeddings and disabled AI Assist",
      );
      setAiAssistNotice("Deleted local embeddings for this project. AI Assist has been turned off until embeddings are rebuilt.");
    } catch (error) {
      console.error("Failed to delete project embeddings:", error);
      setAiAssistError(error instanceof Error ? error.message : "Could not delete local embeddings for this project.");
    } finally {
      setAiAssistDeletingIndex(false);
    }
  }

  async function handleProjectDocumentImportSettingsChange(
    nextSettings: ProjectDocumentImportSettings,
  ) {
    if (!activeProject || !canEditProjectMetadata) return;
    setDocumentImportError("");
    setDocumentImportNotice("");
    try {
      await updateProjectDocumentImportSettings(activeProject.id, nextSettings);
      await logAction(
        activeProject.id,
        "project.document_import.settings",
        nextSettings.storeOriginalFileName
          ? "Enabled original filename storage for imported documents"
          : "Disabled original filename storage for imported documents",
      );
      setDocumentImportNotice("Document import defaults saved.");
    } catch (error) {
      console.error("Failed to update project document import defaults:", error);
      setDocumentImportError("Could not save document import defaults.");
    }
  }

  function openLlmSettingsFromWarning() {
    sessionStorage.setItem("kanqual:open-app-settings-modal", "llm");
    setAiAssistRequirementOpen(false);
    setActiveProjectSettingsModal(null);
    setView("app-settings");
  }

  const projectSettingsCards = [
    {
      id: "details",
      title: "Project Details",
      description: "Update the project name and read-only description shown on Project Home.",
      visible: canEditProjectMetadata,
      tone: "default",
    },
    {
      id: "document-import",
      title: "Document Import",
      description: "Set shared defaults for how newly imported documents are saved into this project.",
      visible: canEditProjectMetadata,
      tone: "default",
    },
    {
      id: "uploaded-files",
      title: "Uploaded Source Files",
      description: "Review retained uploaded files and explicitly delete them without affecting derived documents or cases.",
      visible: canManageUploadedFiles,
      tone: "default",
    },
    {
      id: "backups",
      title: "Project Backups",
      description: "Create backups, review retention, and restore a new copy of the project when needed.",
      visible: canManageBackups || canRestoreProjectBackup,
      tone: "admin",
    },
    {
      id: "log",
      title: "Project Log",
      description: "Review project activity and audit changes made across the project.",
      visible: canAccessProjectSettings,
      tone: "default",
    },
    {
      id: "export",
      title: "Project Export",
      description: "Export the project for review, migration, or secure off-device storage.",
      visible: canExportProject,
      tone: "network",
    },
    {
      id: "codebook",
      title: "Codebook Exchange",
      description: "Import or export the code hierarchy using the REFI-QDA Codebook standard.",
      visible: canExchangeCodebook,
      tone: "default",
    },
  ] as const;

  const visibleProjectSettingsCards = projectSettingsCards.filter((card) => card.visible);
  const projectSettingsCardById = new Map(visibleProjectSettingsCards.map((card) => [card.id, card]));
  const projectSettingsSectionDefs = [
    {
      id: "setup",
      eyebrow: "Project Setup",
      title: "Manage the shared defaults that shape this project's day-to-day work.",
      description: "Start here for project metadata, default import behavior, and project-level AI Assist controls.",
      cardIds: ["details", "document-import"],
    },
    {
      id: "project-data",
      eyebrow: "Project Data",
      title: "Review the files, backups, and audit history that belong to this project.",
      description: "These tools help you manage retained source files, backup snapshots, and project activity over time.",
      cardIds: ["uploaded-files", "backups", "log"],
    },
    {
      id: "exchange",
      eyebrow: "Exchange",
      title: "Move project materials into or out of Kanqual.",
      description: "Use these cards when you need to export the project or exchange only the shared code hierarchy.",
      cardIds: ["export", "codebook"],
    },
  ] satisfies Array<{
    id: string;
    eyebrow: string;
    title: string;
    description: string;
    cardIds: Array<(typeof projectSettingsCards)[number]["id"]>;
  }>;

  const projectSettingsSections = projectSettingsSectionDefs
    .map((section) => ({
      ...section,
      cards: section.cardIds.flatMap((cardId) => {
        const card = projectSettingsCardById.get(cardId);
        return card ? [card] : [];
      }),
    }))
    .filter((section) => section.cards.length > 0);
  const activeProjectSettingsCard = visibleProjectSettingsCards.find((card) => card.id === activeProjectSettingsModal) ?? null;

  function renderProjectSettingsModalBody(sectionId: string) {
    switch (sectionId) {
      case "ai-assist":
        {
          const isActiveProjectBuild =
            projectEmbeddingBuildStatus?.projectId === activeProject?.id;
          const isProjectBuildRunning =
            isActiveProjectBuild && projectEmbeddingBuildStatus?.phase === "running";
          const isProjectBuildCancelling =
            isActiveProjectBuild && projectEmbeddingBuildStatus?.phase === "cancelling";
          const embeddingStatusLabel =
            isProjectBuildRunning
              ? "Building in background"
              : isProjectBuildCancelling
                ? "Cancelling build"
                : aiAssistIndexStatus?.exists
                  ? "Ready"
                  : "Not built";
          const embeddingStatusDetail =
            isProjectBuildRunning
              ? `${projectEmbeddingBuildStatus?.completedItems ?? 0} of ${projectEmbeddingBuildStatus?.totalItems ?? 0} items indexed`
              : isProjectBuildCancelling
                ? "Current project embedding build is stopping."
                : aiAssistIndexStatus?.exists
                  ? [
                      aiAssistIndexStatus.itemCount
                        ? `${aiAssistIndexStatus.itemCount} indexed items`
                        : "Indexed items available",
                      aiAssistIndexStatus.generatedAtMs
                        ? `Last generated ${new Date(aiAssistIndexStatus.generatedAtMs).toLocaleString()}`
                        : "",
                    ].filter(Boolean).join(" • ")
                  : isLocalWorkspace
                    ? "No local project embeddings have been built yet."
                    : "No host project embeddings have been built yet.";
        return (
          <div className="app-settings-modal-sections">
            {aiAssistError && <div className="form-error project-settings-error">{aiAssistError}</div>}
            {aiAssistNotice && <div className="settings-success project-settings-success">{aiAssistNotice}</div>}
            <SettingsModalSection
              title="Project AI Assist"
              description="Turn project-level AI help on or off for everyone working in this project."
            >
              <label className="settings-toggle-row">
                <span>
                  <strong>Enable AI assistance</strong>
                  <small>When disabled, project AI Assist features stay off even if the device is configured for AI Assist.</small>
                </span>
                <input
                  type="checkbox"
                  checked={projectAiAssistSettings.enabled}
                  disabled={aiAssistBuildBusy || !canEnableProjectAiAssist}
                  onChange={(event) => void handleAiAssistEnabledChange(event.target.checked)}
                />
              </label>
            </SettingsModalSection>

            <SettingsModalSection
              title="Project Embeddings"
              description={
                isLocalWorkspace
                  ? "Review the status of this project's local embeddings for AI Assist retrieval and rebuild them when needed."
                  : "Review the status of this project's host embeddings for AI Assist retrieval and rebuild them when needed."
              }
            >
              <div className="app-settings-stats ai-assist-embedding-stats">
                <div className="app-settings-stat-card">
                  <strong>{embeddingStatusLabel}</strong>
                  <span>{aiAssistIndexStatus?.modelDisplayName ?? "multilingual-e5"}</span>
                  <small>{embeddingStatusDetail}</small>
                </div>
              </div>

              {aiAssistBuildPreflight && (
                <div className="users-permission-note" style={{ marginTop: 12 }}>
                  <strong>Best-guess duration:</strong> {aiAssistBuildPreflight.estimateLabel}
                  <br />
                  {formatEstimateRange(
                    aiAssistBuildPreflight.estimatedSecondsLow,
                    aiAssistBuildPreflight.estimatedSecondsHigh,
                  )} for {formatCount(aiAssistBuildPreflight.pendingItems)} new items
                  {aiAssistBuildPreflight.reusedItems > 0
                    ? `, with ${formatCount(aiAssistBuildPreflight.reusedItems)} likely reused`
                    : ""}
                  . This estimate is based on current project contents and recent conservative assumptions for local CPU embedding speed.
                </div>
              )}

              <div className="form-actions" style={{ marginTop: 16, justifyContent: "flex-start" }}>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => void handleAiAssistBuildRun()}
                  disabled={aiAssistBuildBusy || !canBuildProjectEmbeddings}
                  title={canBuildProjectEmbeddings ? undefined : "You do not have permission to build project embeddings."}
                >
                  {isProjectBuildRunning
                    ? "Building..."
                    : aiAssistIndexStatus?.exists
                      ? "Re-run Embeddings"
                      : "Run Embeddings"}
                </button>
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={() => void handleDeleteAiAssistEmbeddings()}
                  disabled={aiAssistBuildBusy || aiAssistDeletingIndex || !aiAssistIndexStatus?.exists || !canDeleteProjectEmbeddings}
                  title={
                    !canDeleteProjectEmbeddings
                      ? "You do not have permission to delete project embeddings."
                      : !aiAssistIndexStatus?.exists
                        ? "No project embeddings are available to delete."
                        : undefined
                  }
                >
                  {aiAssistDeletingIndex ? "Deleting..." : "Delete Embeddings"}
                </button>
              </div>

              {!canBuildProjectEmbeddings && !canDeleteProjectEmbeddings && (
                <div className="users-permission-note" style={{ marginTop: 12 }}>
                  You can view project embedding status, but you do not have permission to rebuild or delete embeddings.
                </div>
              )}
            </SettingsModalSection>
          </div>
        );
        }
      case "details":
        return (
          <div className="app-settings-modal-sections">
            <SettingsModalSection
              title="Current Details"
              description="Review the current project name and description before opening the editor."
            >
              <div className="project-details-card">
                <div>
                  <div className="project-details-name">{activeProject!.name}</div>
                  {hasHtmlText(activeProject!.description) ? (
                    <div
                      className="project-details-description rich-description"
                      dangerouslySetInnerHTML={{ __html: activeProject!.description }}
                    />
                  ) : (
                    <p className="project-details-description project-details-description--empty">
                      No project description has been added yet.
                    </p>
                  )}
                </div>
                <button className="btn btn--primary" onClick={openDetailsModal}>
                  Edit Project Details
                </button>
              </div>
            </SettingsModalSection>
          </div>
        );
      case "document-import":
        return (
          <div className="app-settings-modal-sections">
            {documentImportError && <div className="form-error project-settings-error">{documentImportError}</div>}
            {documentImportNotice && <div className="settings-success project-settings-success">{documentImportNotice}</div>}
            <SettingsModalSection
              title="Shared Import Defaults"
              description="Control the default metadata behavior everyone should use when importing new documents into this project."
            >
              <label className="settings-toggle-row">
                <span>
                  <strong>Store original filename</strong>
                  <small>Use the uploaded filename as stored document metadata by default for everyone importing into this project.</small>
                </span>
                <input
                  type="checkbox"
                  checked={projectDocumentImportSettings.storeOriginalFileName}
                  onChange={(event) => void handleProjectDocumentImportSettingsChange({
                    storeOriginalFileName: event.target.checked,
                  })}
                />
              </label>
            </SettingsModalSection>
          </div>
        );
      case "uploaded-files":
        return (
          <div className="app-settings-modal-sections">
            {uploadedFilesError && <div className="form-error project-settings-error">{uploadedFilesError}</div>}
            {uploadedFilesNotice && <div className="settings-success project-settings-success">{uploadedFilesNotice}</div>}
            <SettingsModalSection
              title="Retained Source Files"
              description="Uploaded source files are retained separately from editable project documents. Deleting a document does not remove its original uploaded file."
            >
              <div className="backup-list">
                {visibleUploadedFiles.length > 0 ? (
                  visibleUploadedFiles.map((file) => (
                    <div key={file.id} className="backup-list-item">
                      <div>
                        <div className="backup-list-title">
                          {file.originalFileName || file.uploadedFile || "Unnamed upload"}
                          <span className="backup-badge backup-badge--scheduled">{file.status}</span>
                        </div>
                        <div className="backup-list-meta">
                          {(file.mimeType || "Unknown type")}
                          {file.sizeBytes > 0 ? ` | ${formatBackupSize(file.sizeBytes)}` : ""}
                          {file.documentId ? ` | Linked document: ${documents.find((doc) => doc.id === file.documentId)?.name ?? "Deleted document"}` : ""}
                          {file.caseId ? ` | Linked case: ${cases.find((item) => item.id === file.caseId)?.name ?? "Deleted case"}` : ""}
                        </div>
                        <div className="backup-list-meta">
                          Uploaded {formatBackupDate(file.createdAt)}
                        </div>
                      </div>
                      <div className="backup-header-actions">
                        {file.uploadedFile && (
                          <a
                            className="btn"
                            href={uploadedFileUrl(file)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Download
                          </a>
                        )}
                        <button
                          className="btn btn--danger"
                          type="button"
                          onClick={() => setUploadedFileDeleteTarget(file)}
                        >
                          Delete Source File
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-state backup-empty-state">
                    <p>No retained uploaded source files are currently available for this project.</p>
                  </div>
                )}
              </div>
            </SettingsModalSection>
          </div>
        );
      case "log":
        return (
          <div className="app-settings-modal-sections">
            <SettingsModalSection
              title="Project Activity"
              description={`Review activity for ${activeProject!.name}. Delete actions automatically create a project backup instead of inline restore actions.`}
            >
              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">Export log</div>
                  <div className="settings-row-desc">Download the project activity log as a CSV file for external review.</div>
                </div>
                <button
                  className="btn"
                  type="button"
                  onClick={() => void handleProjectLogExport()}
                  disabled={projectLogExporting}
                >
                  {projectLogExporting ? "Exporting..." : "Export CSV"}
                </button>
              </div>
            {exportError && <p className="auth-error">{exportError}</p>}
            <ProjectLogTable />
            </SettingsModalSection>
          </div>
        );
      case "backups":
        return (
          <div className="app-settings-modal-sections">
            {backupError && <div className="form-error project-settings-error">{backupError}</div>}
            {backupNotice && <div className="settings-success project-settings-success">{backupNotice}</div>}

            <SettingsModalSection
              title="Backup Controls"
              description="Automatic backups are stored privately in app data for this project. Restore always creates a new project so the current project stays untouched."
            >
              <div className="backup-header-actions">
                {canManageBackups && (
                  <>
                    <button className="btn btn--primary" onClick={handleManualBackup} disabled={!!backupBusy}>
                      {backupBusy === "manual" ? "Creating..." : "Create Backup Now"}
                    </button>
                  </>
                )}
              </div>

              {canManageBackups && (
                <details
                  className="ai-assist-settings-disclosure"
                  onToggle={(event) => {
                    const element = event.currentTarget;
                    if (element.open) {
                      void refreshBackupSettingsDrafts();
                    }
                  }}
                >
                  <summary className="ai-assist-settings-disclosure-summary">Backup settings</summary>
                  <div className="ai-assist-settings-disclosure-body">
                    <form className="form" onSubmit={handleBackupSettingsSave}>
                      <label className="form-label">
                        Minimum automatic backup interval
                        <span className="backup-field-hint">
                          Automatic backups will not be created more often than this, even when project changes are detected.
                        </span>
                        <input
                          className="form-input"
                          type="number"
                          min={1}
                          max={1440}
                          value={automaticIntervalDraft}
                          onChange={(e) => setAutomaticIntervalDraft(Number(e.target.value))}
                          disabled={backupBusy === "settings"}
                        />
                      </label>

                      <div className="backup-retention-form backup-retention-form--modal">
                        <label className="form-label">
                          Hourly window
                          <span className="backup-field-hint">Keep one automatic backup per hour for this many hours.</span>
                          <input
                            className="form-input"
                            type="number"
                            min={1}
                            value={retentionDraft.hourlyHours}
                            onChange={(e) => setRetentionDraft((current) => ({ ...current, hourlyHours: Number(e.target.value) }))}
                            disabled={backupBusy === "settings"}
                          />
                        </label>
                        <label className="form-label">
                          Daily window
                          <span className="backup-field-hint">Keep one automatic backup per day for this many days.</span>
                          <input
                            className="form-input"
                            type="number"
                            min={1}
                            value={retentionDraft.dailyDays}
                            onChange={(e) => setRetentionDraft((current) => ({ ...current, dailyDays: Number(e.target.value) }))}
                            disabled={backupBusy === "settings"}
                          />
                        </label>
                        <label className="form-label">
                          Weekly window
                          <span className="backup-field-hint">Keep one automatic backup per week for this many weeks.</span>
                          <input
                            className="form-input"
                            type="number"
                            min={1}
                            value={retentionDraft.weeklyWeeks}
                            onChange={(e) => setRetentionDraft((current) => ({ ...current, weeklyWeeks: Number(e.target.value) }))}
                            disabled={backupBusy === "settings"}
                          />
                        </label>
                      </div>

                      <div className="project-export-actions project-export-actions--modal">
                        <button type="submit" className="btn btn--primary" disabled={backupBusy === "settings"}>
                          {backupBusy === "settings" ? "Saving..." : "Save Backup Settings"}
                        </button>
                      </div>
                    </form>
                  </div>
                </details>
              )}
            </SettingsModalSection>

            <SettingsModalSection
              title="Available Backups"
              description="Review each retained backup, see why it was created, and restore a copy when you need to recover prior project state."
            >
              <div className="backup-list">
                {backupManifest?.backups.length ? (
                  backupManifest.backups.map((backup) => (
                    <div
                      key={backup.file}
                      className="backup-list-item"
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setBackupContextMenu({ x: event.clientX, y: event.clientY, backup });
                      }}
                    >
                      <div>
                        <div className="backup-list-title">
                          {formatBackupDate(backup.createdAt)}
                          {backup.manual ? (
                            <span className="backup-badge">Retained indefinitely</span>
                          ) : (
                            backupRetentionLabels(backupRetentionStatus(
                              backup,
                              backupManifest.backups,
                              backupManifest.retention,
                              backupStatusNow,
                            )).map((label) => (
                              <span
                                key={label}
                                className={`backup-badge ${
                                  label.startsWith("Will become") ? "backup-badge--promotion" : "backup-badge--scheduled"
                                }`}
                              >
                                {label}
                              </span>
                            ))
                          )}
                        </div>
                        <div className="backup-list-meta">
                          {backupDisplayReason(backup.reason)} backup
                          {formatBackupSize(backup.sizeBytes) ? ` | ${formatBackupSize(backup.sizeBytes)}` : ""}
                        </div>
                        {!backup.manual && (
                          <div className="backup-trigger-row">
                            <span className="backup-badge backup-badge--trigger">
                              Triggered by: {backupTriggerLabel(backup, logEntries)}
                            </span>
                          </div>
                        )}
                      </div>
                      <button
                        className="btn"
                        onClick={() => setRestoreBackup(backup)}
                        disabled={!!backupBusy || !canRestoreProjectBackup}
                      >
                        Restore
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="empty-state backup-empty-state">
                    <p>No backups have been created for this project yet.</p>
                  </div>
                )}
              </div>
            </SettingsModalSection>
          </div>
        );
      case "export":
        return (
          <div className="app-settings-modal-sections">
            {exportError && <p className="auth-error">{exportError}</p>}
            <SettingsModalSection
              title="Recommended: Encrypted Backup"
              description={
                <>
                  <strong>Use this when you need a secure full-project backup for cloud storage, file sharing, USB transfer, or any other off-device storage.</strong>
                  <br />
                  Keep the password in a secure password manager because Kanqual cannot recover it later.
                </>
              }
              tone="warning"
            >
              <div className="form">
                <label className="form-label">
                  Backup password
                  <input
                    className="form-input"
                    type="password"
                    value={encryptedBackupPassword}
                    onChange={(e) => setEncryptedBackupPassword(e.target.value)}
                    placeholder="Enter a password"
                    autoComplete="new-password"
                  />
                </label>
                <label className="form-label">
                  Confirm password
                  <input
                    className="form-input"
                    type="password"
                    value={encryptedBackupPasswordConfirm}
                    onChange={(e) => setEncryptedBackupPasswordConfirm(e.target.value)}
                    placeholder="Re-enter the password"
                    autoComplete="new-password"
                  />
                </label>
                <div className="project-export-actions project-export-actions--modal">
                  <button
                    className="btn btn--primary"
                    onClick={() => void handleEncryptedBackupExport()}
                    disabled={!!exporting || !encryptedBackupPassword || !encryptedBackupPasswordConfirm}
                  >
                    {exporting === "encrypted" ? "Exporting..." : "Export Encrypted Backup"}
                  </button>
                </div>
              </div>
            </SettingsModalSection>
            <SettingsModalSection
              title="Other Whole-Project Exports"
              description={
                <>
                  <strong>Use these when you need to move the full project into another system or create a readable Kanqual-native export.</strong>
                  <br />
                  These exports are not encrypted and can contain project content, coding, memos, and user-linked metadata in readable form.
                </>
              }
              tone="danger"
            >
              <div className="project-export-actions project-export-actions--modal">
                <button className="btn" onClick={() => handleExport("json")} disabled={!!exporting}>
                  {exporting === "json" ? "Exporting..." : "Export JSON Backup"}
                </button>
                <button className="btn" onClick={() => handleExport("qdpx")} disabled={!!exporting}>
                  {exporting === "qdpx" ? "Exporting..." : "Export REFI-QDA Project"}
                </button>
              </div>
              <div className="app-settings-modal-section-body">
                <p className="settings-section-desc">
                  <strong>JSON Backup:</strong> Best for a full Kanqual-native backup or technical inspection.
                </p>
                <p className="settings-section-desc">
                  <strong>REFI-QDA Project:</strong> Best for moving the project to other qualitative analysis tools that support REFI-QDA.
                </p>
              </div>
            </SettingsModalSection>
            <SettingsModalSection
              title="Review Export"
              description="Use this when you want to inspect, report on, or analyze project contents outside Kanqual without moving the full project."
            >
              <div className="project-export-actions project-export-actions--modal">
                <button className="btn btn--primary" onClick={() => handleExport("xlsx")} disabled={!!exporting}>
                  {exporting === "xlsx" ? "Exporting..." : "Export Excel Workbook"}
                </button>
              </div>
              <p className="settings-section-desc">
                <strong>Excel Workbook:</strong> Best for review, reporting, and external analysis outside Kanqual.
              </p>
            </SettingsModalSection>
          </div>
        );
      case "codebook":
        return (
          <div className="app-settings-modal-sections">
            {codebookError && <p className="auth-error">{codebookError}</p>}
            <SettingsModalSection
              title="Codebook Exchange"
              description="Import or export only the code hierarchy using the REFI-QDA Codebook standard."
            >
              <div className="project-export-actions project-export-actions--modal">
                <button className="btn" onClick={handleCodebookImport} disabled={!!codebookBusy}>
                  {codebookBusy === "import" ? "Importing..." : "Import REFI-QDA Codebook"}
                </button>
                <button className="btn btn--primary" onClick={handleCodebookExport} disabled={!!codebookBusy}>
                  {codebookBusy === "export" ? "Exporting..." : "Export REFI-QDA Codebook"}
                </button>
              </div>
            </SettingsModalSection>
          </div>
        );
      default:
        return null;
    }
  }

  if (!activeProject) {
    return (
      <div className="view">
        <header className="view-header">
          <h1>Project Settings</h1>
        </header>
        <div className="empty-state">
          <p>Open a project first.</p>
        </div>
      </div>
    );
  }

  if (!canAccessProjectSettings) {
    return (
      <div className="view">
        <div className="workspace-back-row">
          <button className="btn" onClick={() => setView("home")}>Back to Home</button>
        </div>
        <header className="view-header">
          <h1>Project Settings</h1>
        </header>
        <div className="empty-state">
          <p>You do not have access to Project Settings for this project.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="view project-settings-view">
      <div className="workspace-back-row">
        <button className="btn" onClick={() => setView("home")}>Back to Home</button>
      </div>
      <header className="view-header">
        <div>
          <div className="view-title-with-help">
            <h1>Project Settings</h1>
            <button type="button" className="users-help-icon-btn" onClick={() => setHelpOpen(true)} aria-label="Open project settings help">
              <HelpIcon className="users-help-icon" />
            </button>
          </div>
        </div>
      </header>

      <div className="app-settings-overview-shell project-settings-overview-shell">
        <div className="app-settings-overview-stack">
          <div className="app-settings-overview-sections">
            {projectSettingsSections.map((section) => (
              <section key={section.id} className="app-settings-overview-section">
                <div className="app-settings-overview-section-header">
                  <p className="app-settings-overview-section-eyebrow">{section.eyebrow}</p>
                  <h2>{section.title}</h2>
                  <p>{section.description}</p>
                </div>

                <div className="app-settings-overview-grid">
                  {section.cards.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      className={`app-settings-overview-card app-settings-overview-card--${card.tone}`}
                      onClick={() => setActiveProjectSettingsModal(card.id)}
                    >
                      <h3>{card.title}</h3>
                      <p>{card.description}</p>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>

      {backupContextMenu && (
        <div
          ref={backupContextMenuRef}
          className="context-menu backup-context-menu"
          style={backupContextMenuStyle}
        >
          {backupContextMenu.backup.manual && canManageBackups ? (
            <button
              type="button"
              className="context-menu-item context-menu-item--danger"
              onClick={() => {
                setDeleteBackup(backupContextMenu.backup);
                setBackupContextMenu(null);
              }}
            >
              Delete Manual Backup
            </button>
          ) : (
            <div className="context-menu-item context-menu-item--disabled">
              {backupContextMenu.backup.manual
                ? "You do not have permission to delete manual backups."
                : "Automatic backups are retained based on backup settings"}
            </div>
          )}
        </div>
      )}

      {codebookImportResult && (
        <div className="modal-overlay">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="codebook-import-title">
            <h2 id="codebook-import-title">Codebook Imported</h2>
            <p className="import-project-copy">
              Imported {codebookImportResult.importedCount} code{codebookImportResult.importedCount === 1 ? "" : "s"} into this project.
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  setCodebookImportResult(null);
                  setView("codebook");
                }}
                autoFocus
              >
                View Codebook
              </button>
            </div>
          </div>
        </div>
      )}

      {activeProjectSettingsCard && (
        <div className="modal-overlay" onClick={() => setActiveProjectSettingsModal(null)}>
          <div
            className={`modal ${
              activeProjectSettingsCard.id === "log" ? "modal--project-log" : "modal--wide app-settings-modal"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">{activeProjectSettingsCard.title}</h2>
              </div>
              <button className="btn" type="button" onClick={() => setActiveProjectSettingsModal(null)}>
                Close
              </button>
            </div>
            <div className="app-settings-modal-body">
              {renderProjectSettingsModalBody(activeProjectSettingsCard.id)}
            </div>
            <div className="app-settings-modal-footer">
              {shouldShowProjectAutoSaveNotice(activeProjectSettingsCard.id) ? (
                <p className="app-settings-modal-footer-note">Changes save automatically for this project.</p>
              ) : (
                <span />
              )}
              <button className="btn btn--primary" type="button" onClick={() => setActiveProjectSettingsModal(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {aiAssistRequirementOpen && (
        <div className="modal-overlay" onClick={() => setAiAssistRequirementOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="ai-assist-requirement-title">
            <h2 id="ai-assist-requirement-title">Embedding Model Required</h2>
            <p className="import-project-copy">
              AI Assist needs a local embedding model before it can be enabled for this project. Open App Settings and download the multilingual-e5 model to continue.
            </p>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setAiAssistRequirementOpen(false)}>
                Not Now
              </button>
              <button type="button" className="btn btn--primary" onClick={openLlmSettingsFromWarning}>
                Open LLM Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {aiAssistBuildOpen && (
        <div className="modal-overlay">
          <div className="modal modal--wide app-settings-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="ai-assist-build-title">
            <div className="settings-section-header">
              <div>
                <h2 id="ai-assist-build-title" className="settings-section-title">Preparing AI Assist</h2>
                <p className="settings-section-desc">
                  Kanqual is generating local multilingual-e5 embeddings for this project's cases, documents, codes, annotations, and memos.
                </p>
              </div>
            </div>
            <div className="app-settings-modal-body">
              <div className="project-model-modal-copy">
                <p>
                  This is a first-run setup step. Once these local embeddings are created, AI Assist can reuse them for this project instead of rebuilding them every time.
                </p>
                <p>
                  Large projects can take a little while here, especially the first time the model is loaded into memory.
                </p>
                {aiAssistBuildPreflight && (
                  <div className="users-permission-note" style={{ marginTop: 12 }}>
                    <strong>{aiAssistBuildPreflight.estimateLabel}</strong>
                    <br />
                    {formatEstimateRange(
                      aiAssistBuildPreflight.estimatedSecondsLow,
                      aiAssistBuildPreflight.estimatedSecondsHigh,
                    )} for {formatCount(aiAssistBuildPreflight.pendingItems)} new items
                    {aiAssistBuildPreflight.reusedItems > 0
                      ? `, with ${formatCount(aiAssistBuildPreflight.reusedItems)} likely reused`
                      : ""}
                    . This is intentionally conservative.
                  </div>
                )}
              </div>
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setAiAssistBuildOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => void handleAiAssistBuildRun()}
                  disabled={aiAssistBuildBusy}
                >
                  Run
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {restoreBackup && (
        <div className="modal-overlay" onClick={() => backupBusy !== "restore" && setRestoreBackup(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Restore Backup</h2>
            <p className="import-project-copy">
              This will create a new project from the {backupDisplayReason(restoreBackup.reason).toLowerCase()} backup made on{" "}
              {formatBackupDate(restoreBackup.createdAt)}. The current project will not be overwritten.
            </p>
            {backupError && <p className="auth-error">{backupError}</p>}
            <div className="form-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setRestoreBackup(null)}
                disabled={backupBusy === "restore"}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleRestoreBackup}
                disabled={backupBusy === "restore"}
              >
                {backupBusy === "restore" ? "Restoring..." : "Restore as New Project"}
              </button>
            </div>
          </div>
        </div>
      )}

      {restoreCompleteProject && (
        <div className="modal-overlay">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="project-restore-complete-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="project-restore-complete-title">Project Restore Complete</h2>
            <p className="import-project-copy">
              All users should have access to the project with their existing credentials.
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  const project = restoreCompleteProject;
                  setRestoreCompleteProject(null);
                  openProject(project, activeProject);
                }}
              >
                Go to Project Home
              </button>
            </div>
          </div>
        </div>
      )}

      {restoreResolutionIntro && (
        <div className="modal-overlay">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="project-restore-resolution-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="project-restore-resolution-title">User Accounts Need Review</h2>
            <div className="form">
              {restoreResolutionIntro.notes.map((note) => (
                <p key={note} className="import-project-copy">{note}</p>
              ))}
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  setPendingImportedUserResolution({
                    projectId: restoreResolutionIntro.project.id,
                    projectName: restoreResolutionIntro.project.name,
                    source: "restore",
                    mismatchNotes: restoreResolutionIntro.notes,
                    users: restoreResolutionIntro.users,
                  });
                  const project = restoreResolutionIntro.project;
                  setRestoreResolutionIntro(null);
                  void openProjectToView(project, "users", activeProject);
                }}
              >
                Configure Users
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteBackup && (
        <div className="modal-overlay" onClick={() => backupBusy !== "delete" && setDeleteBackup(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Delete Manual Backup</h2>
            <p className="import-project-copy">
              Delete the manual backup created on {formatBackupDate(deleteBackup.createdAt)}? This cannot be undone.
            </p>
            {backupError && <p className="auth-error">{backupError}</p>}
            <div className="form-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setDeleteBackup(null)}
                disabled={backupBusy === "delete"}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={handleDeleteManualBackup}
                disabled={backupBusy === "delete"}
              >
                {backupBusy === "delete" ? "Deleting..." : "Delete Backup"}
              </button>
            </div>
          </div>
        </div>
      )}

      {detailsOpen && (
        <div className="modal-overlay" onClick={() => !detailsSaving && setDetailsOpen(false)}>
          <div className="modal modal--project-details" onClick={(e) => e.stopPropagation()}>
            <h2>Edit Project Details</h2>
            <form className="form" onSubmit={handleDetailsSave}>
              <label className="form-label">
                Project name
                <input
                  className="form-input"
                  value={detailsName}
                  onChange={(e) => setDetailsName(e.target.value)}
                  disabled={detailsSaving}
                  autoFocus
                />
              </label>
              <label className="form-label">
                Description
                <RichTextEditor initialHtml={detailsDescription} editorRef={detailsDescriptionRef} />
              </label>
              {detailsError && <p className="auth-error">{detailsError}</p>}
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setDetailsOpen(false)} disabled={detailsSaving}>
                  Cancel
                </button>
                <button type="submit" className="btn btn--primary" disabled={!detailsName.trim() || detailsSaving}>
                  {detailsSaving ? "Saving..." : "Save Details"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal modal--help" onClick={(e) => e.stopPropagation()}>
            <h2>Project Settings Help</h2>
            <div className="app-settings-modal-body">
                <p className="settings-section-desc">
                  Open shared settings cards, export the project, manage backups, restore backups, configure AI Assist at the project level, review the project log, exchange codebooks, and edit project details.
                </p>
                <ul className="settings-help-list">
                  <li>Use this page to manage settings and maintenance tasks that belong to the project as a whole. Open a card, complete the action in the modal, and close when finished.</li>
                  <li>Many actions here are permission-gated, and some are sensitive or destructive. Backup, restore, and AI Assist operations may depend on host-side capabilities.</li>
                </ul>
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setHelpOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {uploadedFileDeleteTarget && (
        <div className="modal-overlay" onClick={() => !uploadedFileDeleteBusy && setUploadedFileDeleteTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Delete Retained Source File</h2>
            <p className="import-project-copy">
              This will delete the retained original uploaded file for{" "}
              <strong>{uploadedFileDeleteTarget.originalFileName || uploadedFileDeleteTarget.uploadedFile}</strong>.
            </p>
            <div className="settings-warning settings-warning--danger">
              Documents or cases created from this upload will remain in the project, but future backups and exports will no longer include this original source file.
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setUploadedFileDeleteTarget(null)}
                disabled={uploadedFileDeleteBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => void handleDeleteUploadedFile()}
                disabled={uploadedFileDeleteBusy}
              >
                {uploadedFileDeleteBusy ? "Deleting..." : "Delete Source File"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
