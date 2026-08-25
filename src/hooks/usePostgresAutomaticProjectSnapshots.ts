import { useEffect, useRef } from "react";
import { listPostgresProjectLog, type PostgresProject, type PostgresProjectLogEntry } from "../lib/postgres";
import {
  AUTO_BACKUP_CHECK_INTERVAL_MS,
  createPostgresProjectBackup,
  loadPostgresProjectBackupManifest,
  shouldCreatePostgresAutomaticBackup,
} from "../lib/postgresProjectBackups";
import {
  clearPendingProjectBackupAttempt,
  clearProjectBackupBannerIssue,
  markPendingProjectBackupAttempt,
  notifyProjectBackupsChanged,
  readPendingProjectBackupAttempt,
  writeProjectBackupBannerIssue,
} from "../lib/projectBackupBanner";

const BACKUP_DEBOUNCE_MS = 60 * 1000;
const BACKUP_INTERRUPTION_GRACE_MS = 5 * 60 * 1000;

const BACKUP_REQUIRED_ACTIONS = new Set([
  "project.open",
  "project.close",
  "project.update",
  "member.add",
  "member.update",
  "member.remove",
  "member.reassociate",
  "source.create",
  "source.update",
  "source.delete",
  "source.associations",
  "source_attribute.create",
  "source_attribute.update",
  "source_attribute.delete",
  "object_type.create",
  "object_type.update",
  "object_type.delete",
  "object.create",
  "object.update",
  "object.delete",
  "object.associations",
  "object_attribute.create",
  "object_attribute.update",
  "object_attribute.delete",
  "relationship_type.create",
  "relationship_type.update",
  "relationship_type.delete",
  "relationship.create",
  "relationship.update",
  "relationship.delete",
  "relationship_attribute.create",
  "relationship_attribute.update",
  "relationship_attribute.delete",
  "code.create",
  "code.update",
  "code.delete",
  "annotation.create",
  "annotation.update",
  "annotation.delete",
  "memo.create",
  "memo.update",
  "memo.delete",
  "report.create",
  "report.update",
  "report.delete",
  "project.ai_assist.update",
  "project.ai_processed_document.process_start",
  "codebook.import",
]);

type SnapshotProjectState = {
  project: PostgresProject;
  sourceLogAt: string;
  sourceLog?: PostgresProjectLogEntry;
};

export function usePostgresAutomaticProjectSnapshots(
  activeProject: PostgresProject | null | undefined,
  canManageProjectSnapshots: boolean,
) {
  const inFlightProjectId = useRef<string | null>(null);
  const previousProject = useRef<SnapshotProjectState | null>(null);
  const forcedBackupLogIds = useRef<Set<string>>(new Set());
  const initialSnapshotProjectIds = useRef<Set<string>>(new Set());
  const latestLog = useRef<PostgresProjectLogEntry | null>(null);

  async function loadLatestLog(projectId: string): Promise<PostgresProjectLogEntry | null> {
    const entries = await listPostgresProjectLog(projectId);
    return entries[0] ?? null;
  }

  async function maybeBackup(
    project: PostgresProject,
    reason: "automatic" | "session",
    logStamp: string,
    force = false,
    logEntry?: PostgresProjectLogEntry | null,
  ) {
    if (!canManageProjectSnapshots) return false;
    if (inFlightProjectId.current === project.id) return false;
    inFlightProjectId.current = project.id;
    markPendingProjectBackupAttempt(project.id, reason, logStamp);
    try {
      if (force || await shouldCreatePostgresAutomaticBackup(project, logStamp)) {
        await createPostgresProjectBackup(project, reason, logStamp, logEntry ?? undefined);
        clearPendingProjectBackupAttempt(project.id);
        clearProjectBackupBannerIssue(project.id);
        notifyProjectBackupsChanged(project.id);
      } else {
        clearPendingProjectBackupAttempt(project.id);
      }
      return true;
    } catch (error) {
      console.warn("Automatic PostgreSQL project snapshot failed:", error);
      clearPendingProjectBackupAttempt(project.id);
      writeProjectBackupBannerIssue(
        project.id,
        "failed",
        error instanceof Error ? error.message : "Automatic snapshot failed. Review backup settings and try again.",
      );
      notifyProjectBackupsChanged(project.id);
      return false;
    } finally {
      if (inFlightProjectId.current === project.id) inFlightProjectId.current = null;
    }
  }

  useEffect(() => {
    if (!activeProject || !canManageProjectSnapshots) return;
    initialSnapshotProjectIds.current.delete(activeProject.id);
    const pendingAttempt = readPendingProjectBackupAttempt(activeProject.id);
    if (!pendingAttempt) return;
    const startedAt = Date.parse(pendingAttempt.startedAt);
    if (
      Number.isFinite(startedAt)
      && Date.now() - startedAt < BACKUP_INTERRUPTION_GRACE_MS
    ) {
      return;
    }
    clearPendingProjectBackupAttempt(activeProject.id);
    writeProjectBackupBannerIssue(
      activeProject.id,
      "interrupted",
      "A project snapshot may have been interrupted before it completed. Review the backup list and create a fresh snapshot if needed.",
    );
    notifyProjectBackupsChanged(activeProject.id);
  }, [activeProject?.id, canManageProjectSnapshots]);

  useEffect(() => {
    if (!activeProject || !canManageProjectSnapshots) return;
    const project = activeProject;
    if (initialSnapshotProjectIds.current.has(project.id)) return;
    initialSnapshotProjectIds.current.add(project.id);
    let cancelled = false;

    async function createInitialSnapshotIfMissing() {
      try {
        const manifest = await loadPostgresProjectBackupManifest(project);
        if (cancelled || manifest.backups.length > 0) return;
        const logEntry = await loadLatestLog(project.id);
        if (cancelled) return;
        await maybeBackup(project, "automatic", logEntry?.occurredAt ?? "", true, logEntry);
      } catch {
        initialSnapshotProjectIds.current.delete(project.id);
      }
    }

    void createInitialSnapshotIfMissing();
    return () => {
      cancelled = true;
    };
  }, [activeProject?.id, canManageProjectSnapshots]);

  useEffect(() => {
    const previous = previousProject.current;
    if (previous?.project.id && previous.project.id !== activeProject?.id) {
      void maybeBackup(previous.project, "session", previous.sourceLogAt, true, previous.sourceLog);
    }
    previousProject.current = activeProject ? { project: activeProject, sourceLogAt: "", sourceLog: undefined } : null;
    latestLog.current = null;
  }, [activeProject?.id]);

  useEffect(() => {
    if (!activeProject || !canManageProjectSnapshots) return;
    const project = activeProject;
    let cancelled = false;

    async function refresh() {
      try {
        const logEntry = await loadLatestLog(project.id);
        if (cancelled) return;
        latestLog.current = logEntry;
        previousProject.current = {
          project,
          sourceLogAt: logEntry?.occurredAt ?? "",
          sourceLog: logEntry ?? undefined,
        };
        if (!logEntry || !BACKUP_REQUIRED_ACTIONS.has(logEntry.action)) return;
        if (forcedBackupLogIds.current.has(logEntry.id)) return;
        const created = await maybeBackup(project, "automatic", logEntry.occurredAt, true, logEntry);
        if (created) forcedBackupLogIds.current.add(logEntry.id);
      } catch {
        // Project log polling is best-effort; the interval below will try again.
      }
    }

    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, AUTO_BACKUP_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeProject?.id, canManageProjectSnapshots]);

  useEffect(() => {
    if (!activeProject || !canManageProjectSnapshots) return;
    const timeout = window.setTimeout(() => {
      const logEntry = latestLog.current;
      void maybeBackup(activeProject, "automatic", logEntry?.occurredAt ?? "", false, logEntry);
    }, BACKUP_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [activeProject?.id, canManageProjectSnapshots]);
}
