import type { PostgresProject } from "./postgres";
import { loadPostgresProjectBackupManifest } from "./postgresProjectBackups";

export type ProjectBackupIssueKind = "missing" | "failed" | "interrupted";

export type ProjectBackupBannerIssue = {
  projectId: string;
  kind: ProjectBackupIssueKind;
  message: string;
  updatedAt: string;
};

type PendingProjectBackupAttempt = {
  projectId: string;
  reason: "automatic" | "session";
  sourceLogAt: string;
  startedAt: string;
};

const BACKUP_ISSUE_PREFIX = "kq_project_backup_issue_v1:";
const BACKUP_PENDING_PREFIX = "kq_project_backup_pending_v1:";
export const PROJECT_BACKUPS_CHANGED_EVENT = "kanqual:project-backups-changed";
export const OPEN_PROJECT_SETTINGS_MODAL_EVENT = "kanqual:open-project-settings-modal";

function issueKey(projectId: string): string {
  return `${BACKUP_ISSUE_PREFIX}${projectId}`;
}

function pendingKey(projectId: string): string {
  return `${BACKUP_PENDING_PREFIX}${projectId}`;
}

export function readProjectBackupBannerIssue(projectId: string): ProjectBackupBannerIssue | null {
  try {
    const raw = window.localStorage.getItem(issueKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProjectBackupBannerIssue>;
    if (
      !parsed
      || typeof parsed.projectId !== "string"
      || typeof parsed.kind !== "string"
      || typeof parsed.message !== "string"
      || typeof parsed.updatedAt !== "string"
    ) {
      return null;
    }
    if (parsed.kind !== "missing" && parsed.kind !== "failed" && parsed.kind !== "interrupted") {
      return null;
    }
    return {
      projectId: parsed.projectId,
      kind: parsed.kind,
      message: parsed.message,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

export function writeProjectBackupBannerIssue(
  projectId: string,
  kind: ProjectBackupIssueKind,
  message: string,
): void {
  const issue: ProjectBackupBannerIssue = {
    projectId,
    kind,
    message,
    updatedAt: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(issueKey(projectId), JSON.stringify(issue));
  } catch {
    // Best-effort persistence only.
  }
}

export function clearProjectBackupBannerIssue(projectId: string): void {
  try {
    window.localStorage.removeItem(issueKey(projectId));
  } catch {
    // Best-effort persistence only.
  }
}

export function readPendingProjectBackupAttempt(projectId: string): PendingProjectBackupAttempt | null {
  try {
    const raw = window.localStorage.getItem(pendingKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingProjectBackupAttempt>;
    if (
      !parsed
      || parsed.projectId !== projectId
      || typeof parsed.startedAt !== "string"
      || typeof parsed.sourceLogAt !== "string"
      || (parsed.reason !== "automatic" && parsed.reason !== "session")
    ) {
      return null;
    }
    return {
      projectId,
      startedAt: parsed.startedAt,
      sourceLogAt: parsed.sourceLogAt,
      reason: parsed.reason,
    };
  } catch {
    return null;
  }
}

export function markPendingProjectBackupAttempt(
  projectId: string,
  reason: "automatic" | "session",
  sourceLogAt: string,
): void {
  const pending: PendingProjectBackupAttempt = {
    projectId,
    reason,
    sourceLogAt,
    startedAt: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(pendingKey(projectId), JSON.stringify(pending));
  } catch {
    // Best-effort persistence only.
  }
}

export function clearPendingProjectBackupAttempt(projectId: string): void {
  try {
    window.localStorage.removeItem(pendingKey(projectId));
  } catch {
    // Best-effort persistence only.
  }
}

export function notifyProjectBackupsChanged(projectId: string): void {
  window.dispatchEvent(
    new CustomEvent(PROJECT_BACKUPS_CHANGED_EVENT, {
      detail: { projectId },
    }),
  );
}

export async function loadProjectBackupBannerIssue(project: PostgresProject): Promise<ProjectBackupBannerIssue | null> {
  const manifest = await loadPostgresProjectBackupManifest(project);
  const storedIssue = readProjectBackupBannerIssue(project.id);
  const pendingAttempt = readPendingProjectBackupAttempt(project.id);
  if (storedIssue && (storedIssue.kind === "failed" || storedIssue.kind === "interrupted")) {
    return storedIssue;
  }
  if (pendingAttempt) {
    return null;
  }
  if (manifest.backups.length === 0) {
    return {
      projectId: project.id,
      kind: "missing",
      message: "No backups have been created for this project yet.",
      updatedAt: "",
    };
  }
  return null;
}
