import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { useStore } from "../context/StoreContext";
import { useViewportContextMenuStyle } from "../lib/contextMenu";
import {
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
  buildPostgresProjectEmbeddingSourcesForProject,
  type ProjectEmbeddingBuildPreflight,
  type ProjectEmbeddingStoreStatus,
} from "../lib/projectEmbeddings";
import { readAppSettings } from "../lib/appSettings";
import {
  writeProjectBackupBannerIssue,
  clearPendingProjectBackupAttempt,
  clearProjectBackupBannerIssue,
  notifyProjectBackupsChanged,
  OPEN_PROJECT_SETTINGS_MODAL_EVENT,
} from "../lib/projectBackupBanner";
import {
  formatProjectLogDateTime,
  projectLogAccessModeLabel,
  projectLogActionLabel,
  projectLogActionCategory,
  ProjectLogTable,
  PROJECT_LOG_ACTION_LABELS,
} from "./Project_Log_View";
import type { PendingImportedUser, Project, ProjectLogEntry, ProjectUploadedFile } from "../types";
import { PROJECT_UPLOADED_FILES_COLLECTION } from "../lib/projectUploadedFiles";
import { HelpIcon } from "../components/AppIcons";

const PROJECT_EXPORT_FORMAT_LABELS: Record<"json" | "xlsx" | "qdpx", string> = {
  json: "JSON",
  xlsx: "XLSX",
  qdpx: "QDPX",
};
import { formatCurrentDate, formatCurrentDateTime, formatCurrentNumber } from "../i18n/formatters";
import { useI18n } from "../i18n/provider";

const RTE_TOOLS: { cmd: string; label: string; title: string }[] = [
  { cmd: "bold", label: "B", title: "Bold" },
  { cmd: "italic", label: "I", title: "Italic" },
  { cmd: "underline", label: "U", title: "Underline" },
  { cmd: "insertUnorderedList", label: "UL", title: "Bullet list" },
  { cmd: "insertOrderedList", label: "1.", title: "Numbered list" },
];

type SettingsModalSectionProps = {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  tone?: "default" | "warning" | "danger";
};

function SettingsModalSection({
  title,
  children,
  tone = "default",
}: SettingsModalSectionProps) {
  return (
    <section className="app-settings-modal-section">
      <div className={`app-settings-modal-section-header app-settings-modal-section-header--${tone}`}>
        <h3>{title}</h3>
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
}, t: ReturnType<typeof useI18n>["t"]): string[] {
  const notes: string[] = [];
  if (!summary.identityChecks.backendMatched) {
    notes.push(t("projectSettings.shell.newKanqualInstance"));
  } else if (!summary.identityChecks.usersTableMatched) {
    notes.push(t("projectSettings.shell.userTableMismatch"));
  } else if (!summary.identityChecks.allUsersPresent) {
    notes.push(t("projectSettings.shell.restoredUsersMissing"));
  }
  notes.push(t("projectSettings.shell.configureAssociatedUsersNext"));
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
    .toLocaleString("en-CA", {
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
  return formatCurrentDateTime(date, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatBackupDay(date: Date): string {
  return formatCurrentDate(date, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatBackupHour(date: Date): string {
  return formatCurrentDateTime(date, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
  });
}

function backupReasonLabel(
  reason: ProjectBackupEntry["reason"],
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (reason === "manual") return t("projectSettings.modal.backupReasonManual");
  if (reason === "session") return t("projectSettings.modal.backupReasonSession");
  return t("projectSettings.modal.backupReasonAutomatic");
}

function backupRetentionLabels(
  status: BackupRetentionStatus,
  t: ReturnType<typeof useI18n>["t"],
): Array<{ label: string; promotion: boolean }> {
  const labels: Array<{ label: string; promotion: boolean }> = [];
  if (status.category === "latest") {
    labels.push({ label: t("projectSettings.modal.backupRetentionLatest"), promotion: false });
  } else if (status.category === "hourly" && status.bucketStart) {
    labels.push({
      label: t("projectSettings.modal.backupRetentionHourly", { time: formatBackupHour(status.bucketStart) }),
      promotion: false,
    });
  } else if (status.category === "daily" && status.bucketStart) {
    labels.push({
      label: t("projectSettings.modal.backupRetentionDaily", { date: formatBackupDay(status.bucketStart) }),
      promotion: false,
    });
  } else if (status.category === "weekly" && status.bucketStart) {
    labels.push({
      label: t("projectSettings.modal.backupRetentionWeekly", { date: formatBackupDay(status.bucketStart) }),
      promotion: false,
    });
  } else if (status.category === "pending-delete") {
    labels.push({ label: t("projectSettings.modal.backupDeletesOnNextCleanup"), promotion: false });
  }

  if (status.promotion) {
    labels.push({
      label: t("projectSettings.modal.backupWillBecomePromotion", { promotion: status.promotion }),
      promotion: true,
    });
  } else if (
    status.category !== "pending-delete" &&
    status.deletionDate &&
    status.deletionDate.getTime() > Date.now()
  ) {
    labels.push({
      label: t("projectSettings.modal.backupRetainedUntil", { date: formatBackupDay(status.deletionDate) }),
      promotion: false,
    });
  }
  return labels;
}

function backupTriggerLabel(
  backup: ProjectBackupEntry,
  logEntries: ProjectLogEntry[],
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (backup.manual) return "";
  if (backup.sourceLogAction) return projectLogActionLabel(backup.sourceLogAction, t);
  const logEntry = logEntries.find((entry) => entry.occurredAt === backup.sourceLogAt);
  if (logEntry?.action) return projectLogActionLabel(logEntry.action, t);
  if (backup.reason === "session") return t("projectSettings.modal.backupTriggerSessionChanged");
  return t("projectSettings.modal.backupTriggerScheduled");
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
  return formatCurrentNumber(value);
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
  const { t } = useI18n();
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
  const [aiAssistIndexStatus, setAiAssistIndexStatus] = useState<ProjectEmbeddingStoreStatus | null>(null);
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
        if (!cancelled) setBackupError(t("projectSettings.modal.projectBackupsLoadFailed"));
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
    void invoke<ProjectEmbeddingStoreStatus>("get_project_embedding_store_status", {
      projectId: activeProject.id,
    })
      .then((status) => {
        if (!cancelled) setAiAssistIndexStatus(status);
      })
      .catch((error) => {
        console.error("Failed to load project embedding store status:", error);
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
    void buildPostgresProjectEmbeddingSourcesForProject(activeProject.id, appSettings.llm)
      .then((sources) => invoke<ProjectEmbeddingBuildPreflight>("get_project_embedding_store_build_preflight", {
        request: {
          projectId: activeProject.id,
          batchSize: appSettings.llm.batchSize,
          chunkSize: appSettings.llm.chunkSize,
          overlapSize: appSettings.llm.overlapSize,
          prefixPassages: appSettings.llm.prefixPassages,
          normalizeWhitespace: appSettings.llm.normalizeWhitespace,
          sources,
        },
      }))
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
    function handleOpenProjectSettingsModal() {
      const requestedModal = sessionStorage.getItem("kanqual:open-project-settings-modal");
      if (!requestedModal) return;
      sessionStorage.removeItem("kanqual:open-project-settings-modal");
      setActiveProjectSettingsModal(requestedModal);
    }

    window.addEventListener(OPEN_PROJECT_SETTINGS_MODAL_EVENT, handleOpenProjectSettingsModal);
    return () => {
      window.removeEventListener(OPEN_PROJECT_SETTINGS_MODAL_EVENT, handleOpenProjectSettingsModal);
    };
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
      setDetailsError(error instanceof Error ? error.message : t("projectSettings.modal.detailsUpdateFailed"));
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
            ? { name: t("projectSettings.modal.exportJsonBackupDialog"), extensions: ["json"] }
            : format === "xlsx"
              ? { name: t("projectSettings.modal.exportExcelWorkbookDialog"), extensions: ["xlsx"] }
              : { name: t("projectSettings.modal.exportRefiQdaProjectDialog"), extensions: ["qdpx"] },
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
      await logAction(
        activeProject.id,
        "project.export",
        t("projectLog.labels.projectExport", { format: PROJECT_EXPORT_FORMAT_LABELS[format] }),
        undefined,
        { exportFormat: PROJECT_EXPORT_FORMAT_LABELS[format] },
      );
      setActiveProjectSettingsModal(null);
    } catch (error) {
      console.error("Project export failed:", error);
      setExportError(t("projectSettings.modal.projectExportFailed"));
    } finally {
      setExporting(null);
    }
  }

  async function handleEncryptedBackupExport() {
    if (!activeProject || !canExportProject) return;
    if (!encryptedBackupPassword) {
      setExportError(t("projectSettings.modal.enterPasswordError"));
      return;
    }
    if (encryptedBackupPassword !== encryptedBackupPasswordConfirm) {
      setExportError(t("projectSettings.modal.passwordMismatchError"));
      return;
    }

    setExporting("encrypted");
    setExportError("");
    try {
      const path = await save({
        defaultPath: `${safeExportName(activeProject.name)}_encrypted_backup.kqbe`,
        filters: [{ name: t("projectSettings.modal.exportEncryptedBackupDialog"), extensions: ["kqbe"] }],
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
      await logAction(activeProject.id, "project.encrypted_backup.export", t("projectLog.labels.projectEncryptedBackupExport"), undefined, {
        entityType: "encrypted_project_backup",
        fileName: path.split(/[/\\]/).pop() ?? path,
        exportFormat: "kqbe",
        passwordProtected: true,
      });
      setEncryptedBackupPassword("");
      setEncryptedBackupPasswordConfirm("");
      setActiveProjectSettingsModal(null);
    } catch (error) {
      console.error("Encrypted project backup export failed:", error);
      setExportError(
        error instanceof Error ? error.message : t("projectSettings.modal.encryptedBackupExportFailed"),
      );
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
        filters: [{ name: t("projectSettings.modal.csvFileDialog"), extensions: ["csv"] }],
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
            csvEscape(projectLogAccessModeLabel(entry.accessMode, t)),
            csvEscape(projectLogActionCategory(entry.action)),
            csvEscape(PROJECT_LOG_ACTION_LABELS[entry.action] ?? entry.action),
            csvEscape(entry.label),
          ].join(","),
        ),
      ];

      await writeTextFile(path, lines.join("\n"));
      await logAction(activeProject.id, "project.log.export", t("projectSettings.shell.projectLogCsvExported"));
    } catch (error) {
      console.error("Project log export failed:", error);
      setExportError(t("projectSettings.modal.projectLogExportFailed"));
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
      const { entry, manifest } = await createProjectBackup(pb, activeProject, "manual", logEntries[0]?.occurredAt ?? "");
      setBackupManifest(manifest);
      clearPendingProjectBackupAttempt(activeProject.id);
      clearProjectBackupBannerIssue(activeProject.id);
      notifyProjectBackupsChanged(activeProject.id);
      await logAction(activeProject.id, "project.backup.create", t("projectSettings.modal.manualBackupLog"), entry.file, {
        entityType: "project_backup",
        backupKind: "manual",
        backupFile: entry.file,
        backupCreatedAt: entry.createdAt,
        backupReason: entry.reason,
        sourceLogAt: entry.sourceLogAt,
        sourceLogAction: entry.sourceLogAction,
        sourceLogLabel: entry.sourceLogLabel,
        sizeBytes: entry.sizeBytes,
        manual: entry.manual,
      });
      setBackupNotice(t("projectSettings.modal.manualBackupCreated"));
    } catch (error) {
      console.error("Manual backup failed:", error);
      const message = error instanceof Error ? error.message : t("projectSettings.modal.manualBackupFailed");
      writeProjectBackupBannerIssue(activeProject.id, "failed", message);
      notifyProjectBackupsChanged(activeProject.id);
      setBackupError(message);
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
      setBackupError(t("projectSettings.modal.backupSettingsLoadFailed"));
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
      notifyProjectBackupsChanged(activeProject.id);
      await logAction(
        activeProject.id,
        "project.backup.settings",
        t("projectSettings.modal.backupSettingsUpdatedLog", {
          interval: automaticIntervalDraft,
          hourly: retentionDraft.hourlyHours,
          daily: retentionDraft.dailyDays,
          weekly: retentionDraft.weeklyWeeks,
        }),
        undefined,
        {
          entityType: "project_backup_settings",
          automaticIntervalMinutes: automaticIntervalDraft,
          retention: {
            hourlyHours: retentionDraft.hourlyHours,
            dailyDays: retentionDraft.dailyDays,
            weeklyWeeks: retentionDraft.weeklyWeeks,
          },
          backupCount: manifest.backups.length,
        },
      );
      setBackupNotice(t("projectSettings.modal.backupSettingsSaved"));
    } catch (error) {
      console.error("Backup settings update failed:", error);
      setBackupError(t("projectSettings.modal.backupSettingsSaveFailed"));
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
      await logAction(project.id, "project.restore_backup", t("projectLog.labels.projectRestoreBackup", { date: formatBackupDate(restoreBackup.createdAt) }), restoreBackup.file, {
        entityType: "project_backup",
        backupFile: restoreBackup.file,
        backupCreatedAt: restoreBackup.createdAt,
        backupReason: restoreBackup.reason,
        sourceProjectId: restoreBackup.projectId,
        sourceProjectName: restoreBackup.projectName,
        sourceLogAt: restoreBackup.sourceLogAt,
        sourceLogAction: restoreBackup.sourceLogAction,
        sourceLogLabel: restoreBackup.sourceLogLabel,
        sizeBytes: restoreBackup.sizeBytes,
        manual: restoreBackup.manual,
        restoredProjectId: project.id,
        restoredProjectName: project.name,
        importedTableCounts: summary.tableCounts,
        importedUsersCount: summary.importedUsers.length,
        requiresUserResolution: summary.requiresUserResolution,
      });
      setRestoreBackup(null);
      if (summary.requiresUserResolution) {
        setRestoreResolutionIntro({
          project,
          users: summary.importedUsers,
          notes: mismatchNotes(summary, t),
        });
      } else {
        setRestoreCompleteProject(project);
      }
    } catch (error) {
      console.error("Backup restore failed:", error);
      setBackupError(error instanceof Error ? error.message : t("projectSettings.shell.restoreBackupFailed"));
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
      notifyProjectBackupsChanged(activeProject.id);
      await logAction(
        activeProject.id,
        "project.backup.delete",
        t("projectSettings.modal.manualBackupDeletedLog", {
          date: formatBackupDate(deleteBackup.createdAt),
        }),
        deleteBackup.file,
        {
          entityType: "project_backup",
          backupKind: "manual",
          backupFile: deleteBackup.file,
          backupCreatedAt: deleteBackup.createdAt,
          backupReason: deleteBackup.reason,
          sourceLogAt: deleteBackup.sourceLogAt,
          sourceLogAction: deleteBackup.sourceLogAction,
          sourceLogLabel: deleteBackup.sourceLogLabel,
          sizeBytes: deleteBackup.sizeBytes,
          manual: deleteBackup.manual,
        },
      );
      setDeleteBackup(null);
      setBackupNotice(t("projectSettings.modal.manualBackupDeleted"));
    } catch (error) {
      console.error("Manual backup delete failed:", error);
      setBackupError(error instanceof Error ? error.message : t("projectSettings.modal.manualBackupDeleteFailed"));
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
        filters: [{ name: t("projectSettings.modal.refiQdaCodebookDialog"), extensions: ["qdc", "xml"] }],
      });
      if (!path) return;

      const data = await fetchProjectExportData(pb, activeProject);
      await writeTextFile(path, makeRefiQdaCodebook(data));
      await logAction(activeProject.id, "codebook.export", t("projectSettings.modal.codebookExportedLog"));
      setActiveProjectSettingsModal(null);
    } catch (error) {
      console.error("Codebook export failed:", error);
      setCodebookError(t("projectSettings.modal.codebookExportFailed"));
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
        filters: [{ name: t("projectSettings.modal.refiQdaCodebookDialog"), extensions: ["qdc", "xml"] }],
      });
      if (!selected || Array.isArray(selected)) return;

      await ensureProjectSafetyBackup("codebook.import", t("projectSettings.modal.codebookImportedLog"));
      const raw = await readTextFile(selected);
      const codes = parseRefiQdaCodebook(raw);
      const summary = await importRefiQdaCodebookIntoProject(pb, codes, activeProject.id);
      const importedCount = summary.tableCounts.codes ?? 0;
      await logAction(activeProject.id, "codebook.import", t("projectSettings.modal.codebookImportedCountLog", { count: importedCount }));
      setCodebookImportResult({ importedCount });
      setActiveProjectSettingsModal(null);
    } catch (error) {
      console.error("Codebook import failed:", error);
      setCodebookError(error instanceof Error ? error.message : t("projectSettings.modal.codebookImportFailed"));
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
        await logAction(
          activeProject.id,
          "project.ai_assist.update",
          t("projectLog.labels.projectAiAssistDisabled"),
          undefined,
          { enabled: false },
        );
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
    await logAction(
      activeProject.id,
      "project.ai_assist.update",
      t("projectLog.labels.projectAiAssistEnabled"),
      undefined,
      { enabled: true },
    );
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
      const indexStatus = await invoke<ProjectEmbeddingStoreStatus>("get_project_embedding_store_status", {
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

      const sources = await buildPostgresProjectEmbeddingSourcesForProject(activeProject.id);
      if (sources.length === 0) {
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
          sources: [],
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
      const sources = await buildPostgresProjectEmbeddingSourcesForProject(activeProject.id, appSettings.llm);
      if (sources.length === 0) {
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
        sources,
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
      const nextStatus = await invoke<ProjectEmbeddingStoreStatus>("delete_project_embedding_store", {
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
      setAiAssistError(error instanceof Error ? error.message : t("projectSettings.modal.deleteEmbeddingsError"));
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
      title: t("projectSettings.overview.cards.detailsTitle"),
      description: t("projectSettings.overview.cards.detailsDescription"),
      visible: canEditProjectMetadata,
      tone: "default",
    },
    {
      id: "document-import",
      title: t("projectSettings.overview.cards.documentImportTitle"),
      description: t("projectSettings.overview.cards.documentImportDescription"),
      visible: canEditProjectMetadata,
      tone: "default",
    },
    {
      id: "uploaded-files",
      title: t("projectSettings.overview.cards.uploadedFilesTitle"),
      description: t("projectSettings.overview.cards.uploadedFilesDescription"),
      visible: canManageUploadedFiles,
      tone: "default",
    },
    {
      id: "backups",
      title: t("projectSettings.overview.cards.backupsTitle"),
      description: t("projectSettings.overview.cards.backupsDescription"),
      visible: canManageBackups || canRestoreProjectBackup,
      tone: "admin",
    },
    {
      id: "log",
      title: t("projectSettings.overview.cards.logTitle"),
      description: t("projectSettings.overview.cards.logDescription"),
      visible: canAccessProjectSettings,
      tone: "default",
    },
    {
      id: "export",
      title: t("projectSettings.overview.cards.exportTitle"),
      description: t("projectSettings.overview.cards.exportDescription"),
      visible: canExportProject,
      tone: "network",
    },
    {
      id: "codebook",
      title: t("projectSettings.overview.cards.codebookTitle"),
      description: t("projectSettings.overview.cards.codebookDescription"),
      visible: canExchangeCodebook,
      tone: "default",
    },
  ] as const;

  const visibleProjectSettingsCards = projectSettingsCards.filter((card) => card.visible);
  const projectSettingsCardById = new Map(visibleProjectSettingsCards.map((card) => [card.id, card]));
  const projectSettingsSectionDefs = [
    {
      id: "setup",
      sectionHeading: t("projectSettings.overview.sections.setupEyebrow"),
      cardIds: ["details", "document-import"],
    },
    {
      id: "project-data",
      sectionHeading: t("projectSettings.overview.sections.projectDataEyebrow"),
      cardIds: ["uploaded-files", "backups", "log"],
    },
    {
      id: "exchange",
      sectionHeading: t("projectSettings.overview.sections.exchangeEyebrow"),
      cardIds: ["export", "codebook"],
    },
  ] satisfies Array<{
    id: string;
    sectionHeading: string;
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
              ? t("projectSettings.modal.buildingInBackground")
              : isProjectBuildCancelling
                ? t("projectSettings.modal.cancellingBuild")
                : aiAssistIndexStatus?.exists
                  ? t("projectSettings.modal.ready")
                  : t("projectSettings.modal.notBuilt");
          const embeddingStatusDetail =
            isProjectBuildRunning
              ? `${projectEmbeddingBuildStatus?.completedItems ?? 0} of ${projectEmbeddingBuildStatus?.totalItems ?? 0} items indexed`
              : isProjectBuildCancelling
                ? t("projectSettings.modal.stoppingBuild")
                : aiAssistIndexStatus?.exists
                  ? [
                      aiAssistIndexStatus.itemCount
                        ? `${aiAssistIndexStatus.itemCount} embedded items`
                        : "Indexed items available",
                      aiAssistIndexStatus.generatedAtMs
                        ? `Last generated ${formatCurrentDateTime(aiAssistIndexStatus.generatedAtMs)}`
                        : "",
                    ].filter(Boolean).join(" • ")
                  : isLocalWorkspace
                    ? t("projectSettings.modal.notBuiltLocal")
                    : t("projectSettings.modal.notBuiltHost");
        return (
          <div className="app-settings-modal-sections">
            {aiAssistError && <div className="form-error project-settings-error">{aiAssistError}</div>}
            {aiAssistNotice && <div className="settings-success project-settings-success">{aiAssistNotice}</div>}
            <SettingsModalSection
              title={t("projectSettings.modal.aiAssistTitle")}
              description={t("projectSettings.modal.aiAssistDescription")}
            >
              <label className="settings-toggle-row">
                <span>
                  <strong>{t("projectSettings.modal.enableAiAssistance")}</strong>
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
              title={t("projectSettings.modal.projectEmbeddingsTitle")}
              description={
                isLocalWorkspace
                  ? t("projectSettings.modal.localEmbeddingsDescription")
                  : t("projectSettings.modal.hostEmbeddingsDescription")
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
                    ? t("projectSettings.modal.building")
                    : aiAssistIndexStatus?.exists
                      ? t("projectSettings.modal.rerunEmbeddings")
                      : t("projectSettings.modal.runEmbeddings")}
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
                  {aiAssistDeletingIndex ? t("projectSettings.shell.deleting") : t("projectSettings.modal.deleteEmbeddings")}
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
              title={t("projectSettings.modal.currentDetailsTitle")}
              description={t("projectSettings.modal.currentDetailsDescription")}
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
                      {t("projectSettings.modal.noProjectDescription")}
                    </p>
                  )}
                </div>
                <button className="btn btn--primary" onClick={openDetailsModal}>
                  {t("projectSettings.shell.editProjectDetails")}
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
              title={t("projectSettings.modal.sharedImportDefaultsTitle")}
              description={t("projectSettings.modal.sharedImportDefaultsDescription")}
            >
              <label className="settings-toggle-row">
                <span>
                  <strong>{t("projectSettings.modal.storeOriginalFilename")}</strong>
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
              title={t("projectSettings.modal.retainedSourceFilesTitle")}
              description={t("projectSettings.modal.retainedSourceFilesDescription")}
            >
              <div className="backup-list">
                {visibleUploadedFiles.length > 0 ? (
                  visibleUploadedFiles.map((file) => (
                    <div key={file.id} className="backup-list-item">
                      <div>
                        <div className="backup-list-title">
                          {file.originalFileName || file.uploadedFile || t("projectSettings.modal.unnamedUpload")}
                          <span className="backup-badge backup-badge--scheduled">
                            {file.status === "orphaned"
                              ? t("projectSettings.modal.orphanedBadge")
                              : t("projectSettings.modal.linkedBadge")}
                          </span>
                        </div>
                        <div className="backup-list-meta">
                          {(file.mimeType || t("projectSettings.modal.unknownFileType"))}
                          {file.sizeBytes > 0 ? ` | ${formatBackupSize(file.sizeBytes)}` : ""}
                          {file.documentId ? ` | ${t("projectSettings.modal.linkedDocument")}: ${documents.find((doc) => doc.id === file.documentId)?.name ?? t("projectSettings.modal.deletedDocument")}` : ""}
                          {file.caseId ? ` | ${t("projectSettings.modal.linkedCase")}: ${cases.find((item) => item.id === file.caseId)?.name ?? t("projectSettings.modal.deletedCase")}` : ""}
                        </div>
                        <div className="backup-list-meta">
                          {t("projectSettings.modal.uploadedAt", { date: formatBackupDate(file.createdAt) })}
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
                            {t("common.download")}
                          </a>
                        )}
                        <button
                          className="btn btn--danger"
                          type="button"
                          onClick={() => setUploadedFileDeleteTarget(file)}
                        >
                          {t("projectSettings.shell.deleteSourceFile")}
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-state backup-empty-state">
                    <p>{t("projectSettings.modal.noRetainedUploadedFiles")}</p>
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
              title={t("projectSettings.modal.projectActivityTitle")}
              description={t("projectSettings.modal.projectActivityDescription", { projectName: activeProject!.name })}
            >
              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">{t("projectSettings.modal.exportLogTitle")}</div>
                  <div className="settings-row-desc">{t("projectSettings.modal.exportLogDescription")}</div>
                </div>
                <button
                  className="btn"
                  type="button"
                  onClick={() => void handleProjectLogExport()}
                  disabled={projectLogExporting}
                >
                  {projectLogExporting ? t("projectSettings.modal.exporting") : t("projectSettings.modal.exportCsv")}
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
              title={t("projectSettings.modal.backupControlsTitle")}
              description={t("projectSettings.modal.backupControlsDescription")}
            >
              <div className="backup-header-actions">
                {canManageBackups && (
                  <>
                    <button className="btn btn--primary" onClick={handleManualBackup} disabled={!!backupBusy}>
                      {backupBusy === "manual" ? t("projectSettings.modal.creating") : t("projectSettings.modal.createBackupNow")}
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
                  <summary className="ai-assist-settings-disclosure-summary">{t("projectSettings.modal.backupControlsTitle")}</summary>
                  <div className="ai-assist-settings-disclosure-body">
                    <form className="form" onSubmit={handleBackupSettingsSave}>
                      <label className="form-label">
                        {t("projectSettings.modal.minimumAutomaticBackupInterval")}
                        <span className="backup-field-hint">
                          {t("projectSettings.modal.minimumAutomaticBackupIntervalHint")}
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
                          {t("projectSettings.modal.hourlyWindow")}
                          <span className="backup-field-hint">{t("projectSettings.modal.hourlyWindowHint")}</span>
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
                          {t("projectSettings.modal.dailyWindow")}
                          <span className="backup-field-hint">{t("projectSettings.modal.dailyWindowHint")}</span>
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
                          {t("projectSettings.modal.weeklyWindow")}
                          <span className="backup-field-hint">{t("projectSettings.modal.weeklyWindowHint")}</span>
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
                          {backupBusy === "settings" ? t("projectSettings.shell.saving") : t("projectSettings.modal.saveBackupSettings")}
                        </button>
                      </div>
                    </form>
                  </div>
                </details>
              )}
            </SettingsModalSection>

            <SettingsModalSection
              title={t("projectSettings.modal.availableBackupsTitle")}
              description={t("projectSettings.modal.availableBackupsDescription")}
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
                            <span className="backup-badge">{t("projectSettings.modal.retainedIndefinitely")}</span>
                          ) : (
                            backupRetentionLabels(backupRetentionStatus(
                              backup,
                              backupManifest.backups,
                              backupManifest.retention,
                              backupStatusNow,
                            ), t).map((item) => (
                              <span
                                key={item.label}
                                className={`backup-badge ${
                                  item.promotion ? "backup-badge--promotion" : "backup-badge--scheduled"
                                }`}
                              >
                                {item.label}
                              </span>
                            ))
                          )}
                        </div>
                        <div className="backup-list-meta">
                          {t("projectSettings.modal.backupReasonLine", { reason: backupReasonLabel(backup.reason, t) })}
                          {formatBackupSize(backup.sizeBytes) ? ` | ${formatBackupSize(backup.sizeBytes)}` : ""}
                        </div>
                        {!backup.manual && (
                          <div className="backup-trigger-row">
                            <span className="backup-badge backup-badge--trigger">
                              {t("projectSettings.modal.triggeredBy")}: {backupTriggerLabel(backup, logEntries, t)}
                            </span>
                          </div>
                        )}
                      </div>
                      <button
                        className="btn"
                        onClick={() => setRestoreBackup(backup)}
                        disabled={!!backupBusy || !canRestoreProjectBackup}
                      >
                        {t("projectSettings.shell.restore")}
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="empty-state backup-empty-state">
                    <p>{t("projectSettings.modal.noProjectBackupsYet")}</p>
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
              title={t("projectSettings.modal.encryptedBackupTitle")}
              description={
                <>
                  <strong>{t("projectSettings.modal.encryptedBackupLead")}</strong>
                  <br />
                  {t("projectSettings.modal.encryptedBackupNote")}
                </>
              }
              tone="warning"
            >
              <div className="form">
                <label className="form-label">
                  {t("projectSettings.modal.backupPassword")}
                  <input
                    className="form-input"
                    type="password"
                    value={encryptedBackupPassword}
                    onChange={(e) => setEncryptedBackupPassword(e.target.value)}
                    placeholder={t("projectSettings.modal.enterPassword")}
                    autoComplete="new-password"
                  />
                </label>
                <label className="form-label">
                  {t("projectSettings.modal.confirmPassword")}
                  <input
                    className="form-input"
                    type="password"
                    value={encryptedBackupPasswordConfirm}
                    onChange={(e) => setEncryptedBackupPasswordConfirm(e.target.value)}
                    placeholder={t("projectSettings.modal.reenterPassword")}
                    autoComplete="new-password"
                  />
                </label>
                <div className="project-export-actions project-export-actions--modal">
                  <button
                    className="btn btn--primary"
                    onClick={() => void handleEncryptedBackupExport()}
                    disabled={!!exporting || !encryptedBackupPassword || !encryptedBackupPasswordConfirm}
                  >
                    {exporting === "encrypted" ? t("projectSettings.modal.exporting") : t("projectSettings.modal.exportEncryptedBackup")}
                  </button>
                </div>
              </div>
            </SettingsModalSection>
            <SettingsModalSection
              title={t("projectSettings.modal.wholeProjectExportsTitle")}
              description={
                <>
                  <strong>{t("projectSettings.modal.wholeProjectExportsLead")}</strong>
                  <br />
                  {t("projectSettings.modal.wholeProjectExportsNote")}
                </>
              }
              tone="danger"
            >
              <div className="project-export-actions project-export-actions--modal">
                <button className="btn" onClick={() => handleExport("json")} disabled={!!exporting}>
                  {exporting === "json" ? t("projectSettings.modal.exporting") : t("projectSettings.modal.exportJsonBackup")}
                </button>
                <button className="btn" onClick={() => handleExport("qdpx")} disabled={!!exporting}>
                  {exporting === "qdpx" ? t("projectSettings.modal.exporting") : t("projectSettings.modal.exportRefiQdaProject")}
                </button>
              </div>
              <div className="app-settings-modal-section-body">
              </div>
            </SettingsModalSection>
            <SettingsModalSection
              title={t("projectSettings.modal.reviewExportTitle")}
              description={t("projectSettings.modal.reviewExportDescription")}
            >
              <div className="project-export-actions project-export-actions--modal">
                <button className="btn btn--primary" onClick={() => handleExport("xlsx")} disabled={!!exporting}>
                  {exporting === "xlsx" ? t("projectSettings.modal.exporting") : t("projectSettings.modal.exportExcelWorkbook")}
                </button>
              </div>
            </SettingsModalSection>
          </div>
        );
      case "codebook":
        return (
          <div className="app-settings-modal-sections">
            {codebookError && <p className="auth-error">{codebookError}</p>}
            <SettingsModalSection
              title={t("projectSettings.modal.codebookExchangeTitle")}
              description={t("projectSettings.modal.codebookExchangeDescription")}
            >
              <div className="project-export-actions project-export-actions--modal">
                <button className="btn" onClick={handleCodebookImport} disabled={!!codebookBusy}>
                  {codebookBusy === "import" ? t("projectSettings.modal.importing") : t("projectSettings.modal.importRefiQdaCodebook")}
                </button>
                <button className="btn btn--primary" onClick={handleCodebookExport} disabled={!!codebookBusy}>
                  {codebookBusy === "export" ? t("projectSettings.modal.exporting") : t("projectSettings.modal.exportRefiQdaCodebook")}
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
          <h1>{t("projectSettings.shell.pageTitle")}</h1>
        </header>
        <div className="empty-state">
          <p>{t("sidebar.nav.openProjectFirst")}</p>
        </div>
      </div>
    );
  }

  if (!canAccessProjectSettings) {
    return (
      <div className="view">
        <div className="workspace-back-row">
          <button className="btn" onClick={() => setView("home")}>{t("projectSettings.shell.backToHome")}</button>
        </div>
        <header className="view-header">
          <h1>{t("projectSettings.shell.pageTitle")}</h1>
        </header>
        <div className="empty-state">
          <p>{t("projectSettings.shell.noAccess")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="view project-settings-view">
      <div className="workspace-back-row">
        <button className="btn" onClick={() => setView("home")}>{t("projectSettings.shell.backToHome")}</button>
      </div>
      <header className="view-header">
        <div>
          <div className="view-title-with-help">
            <h1>{t("projectSettings.shell.pageTitle")}</h1>
            <button type="button" className="users-help-icon-btn" onClick={() => setHelpOpen(true)} aria-label={t("projectSettings.shell.openHelp")}>
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
                  <p className="app-settings-overview-section-heading">{section.sectionHeading}</p>
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
              {t("projectSettings.shell.deleteManualBackup")}
            </button>
          ) : (
            <div className="context-menu-item context-menu-item--disabled">
              {backupContextMenu.backup.manual
                ? t("projectSettings.shell.deleteManualBackupDenied")
                : t("projectSettings.shell.automaticBackupsRetained")}
            </div>
          )}
        </div>
      )}

      {codebookImportResult && (
        <div className="modal-overlay">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="codebook-import-title">
            <h2 id="codebook-import-title">{t("projectSettings.shell.codebookImportedTitle")}</h2>
            <p className="import-project-copy">
              {t("projectSettings.shell.codebookImportedBody", { count: codebookImportResult.importedCount })}
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
                {t("projectSettings.shell.viewCodebook")}
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
            </div>
            <div className="app-settings-modal-body">
              {renderProjectSettingsModalBody(activeProjectSettingsCard.id)}
            </div>
            <div className="app-settings-modal-footer">
              {shouldShowProjectAutoSaveNotice(activeProjectSettingsCard.id) ? (
                <p className="app-settings-modal-footer-note">{t("projectSettings.shell.autoSaveNotice")}</p>
              ) : (
                <span />
              )}
              <button className="btn btn--primary" type="button" onClick={() => setActiveProjectSettingsModal(null)}>
                {t("projectSettings.shell.done")}
              </button>
            </div>
          </div>
        </div>
      )}

      {aiAssistRequirementOpen && (
        <div className="modal-overlay" onClick={() => setAiAssistRequirementOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="ai-assist-requirement-title">
            <h2 id="ai-assist-requirement-title">{t("projectSettings.shell.embeddingRequiredTitle")}</h2>
            <p className="import-project-copy">
              {t("projectSettings.shell.embeddingRequiredBody")}
            </p>
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => setAiAssistRequirementOpen(false)}>
                {t("projectSettings.shell.notNow")}
              </button>
              <button type="button" className="btn btn--primary" onClick={openLlmSettingsFromWarning}>
                {t("projectSettings.shell.openLlmSettings")}
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
                <h2 id="ai-assist-build-title" className="settings-section-title">{t("projectSettings.shell.preparingAiAssist")}</h2>
              </div>
            </div>
            <div className="app-settings-modal-body">
              <div className="project-model-modal-copy">
                <p>
                  {t("projectSettings.shell.firstRunLine1")}
                </p>
                <p>
                  {t("projectSettings.shell.firstRunLine2")}
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
                      ? t("projectSettings.shell.likelyReused", { count: formatCount(aiAssistBuildPreflight.reusedItems) })
                      : ""}
                    {t("projectSettings.shell.conservativeEstimate")}
                  </div>
                )}
              </div>
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setAiAssistBuildOpen(false)}>
                  {t("projectSettings.shell.cancel")}
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => void handleAiAssistBuildRun()}
                  disabled={aiAssistBuildBusy}
                >
                  {t("projectSettings.shell.run")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {restoreBackup && (
        <div className="modal-overlay" onClick={() => backupBusy !== "restore" && setRestoreBackup(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t("projectSettings.shell.restoreBackupTitle")}</h2>
            <p className="import-project-copy">
              {t("projectSettings.shell.restoreBackupBody", {
                reason: backupReasonLabel(restoreBackup.reason, t),
                date: formatBackupDate(restoreBackup.createdAt),
              })}
            </p>
            {backupError && <p className="auth-error">{backupError}</p>}
            <div className="form-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setRestoreBackup(null)}
                disabled={backupBusy === "restore"}
              >
                {t("projectSettings.shell.cancel")}
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleRestoreBackup}
                disabled={backupBusy === "restore"}
              >
                {backupBusy === "restore"
                  ? t("projectSettings.shell.restoring")
                  : t("projectSettings.shell.restoreAsNewProject")}
              </button>
            </div>
          </div>
        </div>
      )}

      {restoreCompleteProject && (
        <div className="modal-overlay">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="project-restore-complete-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="project-restore-complete-title">{t("projectSettings.shell.restoreCompleteTitle")}</h2>
            <p className="import-project-copy">
              {t("projectSettings.shell.restoreCompleteBody")}
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
                {t("projectSettings.shell.goToProjectHome")}
              </button>
            </div>
          </div>
        </div>
      )}

      {restoreResolutionIntro && (
        <div className="modal-overlay">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="project-restore-resolution-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="project-restore-resolution-title">{t("projectSettings.shell.userAccountsReviewTitle")}</h2>
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
                {t("projectSettings.shell.configureUsers")}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteBackup && (
        <div className="modal-overlay" onClick={() => backupBusy !== "delete" && setDeleteBackup(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t("projectSettings.shell.deleteManualBackup")}</h2>
            <p className="import-project-copy">
              {t("projectSettings.shell.deleteManualBackupBody", {
                date: formatBackupDate(deleteBackup.createdAt),
              })}
            </p>
            {backupError && <p className="auth-error">{backupError}</p>}
            <div className="form-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setDeleteBackup(null)}
                disabled={backupBusy === "delete"}
              >
                {t("projectSettings.shell.cancel")}
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={handleDeleteManualBackup}
                disabled={backupBusy === "delete"}
              >
                {backupBusy === "delete" ? t("projectSettings.shell.deleting") : t("projectSettings.shell.deleteBackup")}
              </button>
            </div>
          </div>
        </div>
      )}

      {detailsOpen && (
        <div className="modal-overlay" onClick={() => !detailsSaving && setDetailsOpen(false)}>
          <div className="modal modal--project-details" onClick={(e) => e.stopPropagation()}>
            <h2>{t("projectSettings.shell.editProjectDetails")}</h2>
            <form className="form" onSubmit={handleDetailsSave}>
              <label className="form-label">
                {t("projectSettings.shell.projectName")}
                <input
                  className="form-input"
                  value={detailsName}
                  onChange={(e) => setDetailsName(e.target.value)}
                  disabled={detailsSaving}
                  autoFocus
                />
              </label>
              <label className="form-label">
                {t("projectSettings.shell.description")}
                <RichTextEditor initialHtml={detailsDescription} editorRef={detailsDescriptionRef} />
              </label>
              {detailsError && <p className="auth-error">{detailsError}</p>}
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setDetailsOpen(false)} disabled={detailsSaving}>
                  {t("projectSettings.shell.cancel")}
                </button>
                <button type="submit" className="btn btn--primary" disabled={!detailsName.trim() || detailsSaving}>
                  {detailsSaving ? t("projectSettings.shell.saving") : t("projectSettings.shell.saveDetails")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal modal--help" onClick={(e) => e.stopPropagation()}>
            <h2>{t("projectSettings.shell.projectSettingsHelp")}</h2>
            <div className="app-settings-modal-body">
                <ul className="settings-help-list">
                  <li>{t("projectSettings.shell.helpLine1")}</li>
                  <li>{t("projectSettings.shell.helpLine2")}</li>
                </ul>
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setHelpOpen(false)}>
                  {t("projectSettings.shell.close")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {uploadedFileDeleteTarget && (
        <div className="modal-overlay" onClick={() => !uploadedFileDeleteBusy && setUploadedFileDeleteTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t("projectSettings.shell.deleteSourceFileTitle")}</h2>
            <p className="import-project-copy">
              {t("projectSettings.shell.deleteSourceFileBody", {
                fileName: uploadedFileDeleteTarget.originalFileName || uploadedFileDeleteTarget.uploadedFile,
              })}
            </p>
            <div className="settings-warning settings-warning--danger">
              {t("projectSettings.shell.deleteSourceFileWarning")}
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setUploadedFileDeleteTarget(null)}
                disabled={uploadedFileDeleteBusy}
              >
                {t("projectSettings.shell.cancel")}
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => void handleDeleteUploadedFile()}
                disabled={uploadedFileDeleteBusy}
              >
                {uploadedFileDeleteBusy ? t("projectSettings.shell.deleting") : t("projectSettings.shell.deleteSourceFile")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
