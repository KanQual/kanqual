import { useEffect, useRef } from "react";
import { useStore } from "../context/StoreContext";
import {
  AUTO_BACKUP_CHECK_INTERVAL_MS,
  createProjectBackup,
  shouldCreateAutomaticBackup,
} from "../lib/projectBackups";
import {
  clearPendingProjectBackupAttempt,
  clearProjectBackupBannerIssue,
  markPendingProjectBackupAttempt,
  notifyProjectBackupsChanged,
  readPendingProjectBackupAttempt,
  writeProjectBackupBannerIssue,
} from "../lib/projectBackupBanner";
import type { Project, ProjectLogEntry } from "../types";

const BACKUP_DEBOUNCE_MS = 60 * 1000;
const BACKUP_REQUIRED_ACTIONS = new Set([
  "project.open",
  "project.close",
  "project.update",
  "member.add",
  "member.update",
  "member.reassociate",
  "source.create",
  "source.update",
  "source.associations",
  "document_attribute.create",
  "document_attribute.update",
  "code.create",
  "code.update",
  "annotation.create",
  "annotation.update",
  "case.create",
  "case.update",
  "case.associations",
  "case_attribute.create",
  "case_attribute.update",
  "memo.create",
  "memo.update",
  "report.create",
  "report.update",
  "codebook.import",
]);

export function useAutomaticProjectBackups() {
  const { pb, activeProject, userRole, canCurrentUser, logEntries, logAction } = useStore();
  const inFlightProjectId = useRef<string | null>(null);
  const previousProject = useRef<{ project: Project; sourceLogAt: string; sourceLog?: ProjectLogEntry } | null>(null);
  const forcedBackupLogIds = useRef<Set<string>>(new Set());
  const sourceLogAt = logEntries[0]?.occurredAt ?? "";
  const sourceLog = logEntries[0];
  const latestLogId = logEntries[0]?.id ?? "";
  const latestLogAction = logEntries[0]?.action ?? "";

  async function maybeBackup(
    project: Project,
    reason: "automatic" | "session",
    logStamp: string,
    force = false,
    logEntry?: ProjectLogEntry,
  ) {
    if (userRole !== "owner") return false;
    if (inFlightProjectId.current === project.id) return false;
    inFlightProjectId.current = project.id;
    markPendingProjectBackupAttempt(project.id, reason, logStamp);
    try {
      if (force || await shouldCreateAutomaticBackup(pb, project, logStamp)) {
        const { entry } = await createProjectBackup(pb, project, reason, logStamp, logEntry);
        await logAction(
          project.id,
          "project.backup.create",
          reason === "session"
            ? "Created a session backup"
            : "Created an automatic project backup",
          entry.file,
          {
            entityType: "project_backup",
            backupKind: reason,
            backupFile: entry.file,
            backupCreatedAt: entry.createdAt,
            backupReason: entry.reason,
            sourceLogAt: entry.sourceLogAt,
            sourceLogAction: entry.sourceLogAction,
            sourceLogLabel: entry.sourceLogLabel,
            sizeBytes: entry.sizeBytes,
            manual: entry.manual,
          },
        );
        clearPendingProjectBackupAttempt(project.id);
        clearProjectBackupBannerIssue(project.id);
        notifyProjectBackupsChanged(project.id);
      }
      return true;
    } catch (error) {
      console.warn("Automatic project backup failed:", error);
      clearPendingProjectBackupAttempt(project.id);
      writeProjectBackupBannerIssue(
        project.id,
        "failed",
        error instanceof Error ? error.message : "Automatic backup failed. Review backup settings and try again.",
      );
      notifyProjectBackupsChanged(project.id);
      return false;
    } finally {
      if (inFlightProjectId.current === project.id) inFlightProjectId.current = null;
    }
  }

  useEffect(() => {
    if (!activeProject || !canCurrentUser("manageBackupsAndRestores")) return;
    const pendingAttempt = readPendingProjectBackupAttempt(activeProject.id);
    if (!pendingAttempt) return;
    clearPendingProjectBackupAttempt(activeProject.id);
    writeProjectBackupBannerIssue(
      activeProject.id,
      "interrupted",
      "A project backup may have been interrupted before it completed. Review the backup list and create a fresh backup if needed.",
    );
    notifyProjectBackupsChanged(activeProject.id);
  }, [activeProject?.id, canCurrentUser]);

  useEffect(() => {
    const previous = previousProject.current;
    if (previous?.project.id && previous.project.id !== activeProject?.id) {
      void maybeBackup(previous.project, "session", previous.sourceLogAt, true, previous.sourceLog);
    }
    previousProject.current = activeProject ? { project: activeProject, sourceLogAt, sourceLog } : null;
  }, [activeProject?.id]);

  useEffect(() => {
    if (!activeProject || userRole !== "owner") return;
    previousProject.current = { project: activeProject, sourceLogAt, sourceLog };
  }, [activeProject, sourceLogAt, userRole]);

  useEffect(() => {
    if (!activeProject || userRole !== "owner") return;
    if (!latestLogId || !BACKUP_REQUIRED_ACTIONS.has(latestLogAction)) return;
    if (forcedBackupLogIds.current.has(latestLogId)) return;
    void maybeBackup(activeProject, "automatic", sourceLogAt, true, sourceLog).then((created) => {
      if (created) forcedBackupLogIds.current.add(latestLogId);
    });
  }, [activeProject?.id, userRole, latestLogId, latestLogAction, sourceLogAt, sourceLog]);

  useEffect(() => {
    if (!activeProject || userRole !== "owner") return;
    const timeout = window.setTimeout(() => {
      void maybeBackup(activeProject, "automatic", sourceLogAt, false, sourceLog);
    }, BACKUP_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [activeProject?.id, userRole, latestLogId, sourceLogAt, sourceLog]);

  useEffect(() => {
    if (!activeProject || userRole !== "owner") return;
    const interval = window.setInterval(() => {
      void maybeBackup(activeProject, "automatic", sourceLogAt, false, sourceLog);
    }, AUTO_BACKUP_CHECK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [activeProject?.id, userRole, sourceLogAt, sourceLog, logAction]);
}
