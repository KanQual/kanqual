import { invoke } from "@tauri-apps/api/core";
import type { PostgresProject } from "./postgres";
import type { ProjectBackupReason } from "./projectExport";

export type BackupRetentionSettings = {
  hourlyHours: number;
  dailyDays: number;
  weeklyWeeks: number;
};

export type PostgresProjectBackupSettings = {
  retention: BackupRetentionSettings;
  automaticIntervalMinutes: number;
};

export type PostgresProjectBackupEntry = {
  id: string;
  file: string;
  createdAt: string;
  reason: ProjectBackupReason;
  manual: boolean;
  projectId: string;
  projectName: string;
  name: string;
  sizeBytes: number;
  databaseBytes: number;
  storageBytes: number;
  storageFileCount: number;
  kanqualVersion: string;
  postgresVersion: string;
  createdBy: string;
  sourceLogAt: string;
  sourceLogAction: string;
  sourceLogLabel: string;
};

export type PostgresProjectBackupManifest = {
  version: 1;
  projectId: string;
  projectName: string;
  latestBackupAt: string;
  lastSourceLogAt: string;
  retention: BackupRetentionSettings;
  automaticIntervalMinutes: number;
  backups: PostgresProjectBackupEntry[];
};

export type BackupRetentionCategory = "manual" | "latest" | "hourly" | "daily" | "weekly" | "pending-delete";

export type BackupRetentionStatus = {
  category: BackupRetentionCategory;
  bucketStart: Date | null;
  promotion: "hourly" | "daily" | "weekly" | null;
  deletionDate: Date | null;
};

export const DEFAULT_BACKUP_RETENTION: BackupRetentionSettings = {
  hourlyHours: 24,
  dailyDays: 30,
  weeklyWeeks: 12,
};
export const DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES = 15;
export const AUTO_BACKUP_CHECK_INTERVAL_MS = 60 * 1000;

type PostgresProjectSnapshot = {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  reason: ProjectBackupReason;
  sourceLogAt: string;
  sourceLogAction: string;
  sourceLogLabel: string;
  kanqualVersion: string;
  postgresVersion: string;
  schemaVersion: number;
  databaseBytes: number;
  storageBytes: number;
  storageFileCount: number;
  createdBy: string;
  createdAt: string;
};

function clampWindow(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(3650, Math.floor(n)));
}

function normalizeRetention(value: unknown): BackupRetentionSettings {
  const settings = (value && typeof value === "object" ? value : {}) as Partial<BackupRetentionSettings>;
  return {
    hourlyHours: clampWindow(settings.hourlyHours, DEFAULT_BACKUP_RETENTION.hourlyHours),
    dailyDays: clampWindow(settings.dailyDays, DEFAULT_BACKUP_RETENTION.dailyDays),
    weeklyWeeks: clampWindow(settings.weeklyWeeks, DEFAULT_BACKUP_RETENTION.weeklyWeeks),
  };
}

function normalizeIntervalMinutes(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES;
  return Math.max(1, Math.min(1440, Math.floor(n)));
}

function normalizeReason(value: unknown): ProjectBackupReason {
  return value === "manual" || value === "session" ? value : "automatic";
}

function snapshotToBackup(snapshot: PostgresProjectSnapshot): PostgresProjectBackupEntry {
  return {
    id: snapshot.id,
    file: snapshot.id,
    createdAt: snapshot.createdAt,
    reason: normalizeReason(snapshot.reason),
    manual: snapshot.reason === "manual" || !snapshot.reason,
    projectId: snapshot.projectId,
    projectName: snapshot.projectName,
    name: snapshot.name,
    sizeBytes: (snapshot.databaseBytes || 0) + (snapshot.storageBytes || 0),
    databaseBytes: snapshot.databaseBytes || 0,
    storageBytes: snapshot.storageBytes || 0,
    storageFileCount: snapshot.storageFileCount || 0,
    kanqualVersion: snapshot.kanqualVersion,
    postgresVersion: snapshot.postgresVersion,
    createdBy: snapshot.createdBy,
    sourceLogAt: snapshot.sourceLogAt || "",
    sourceLogAction: snapshot.sourceLogAction || "",
    sourceLogLabel: snapshot.sourceLogLabel || "",
  };
}

function manifestFromSnapshots(
  project: PostgresProject,
  snapshots: PostgresProjectSnapshot[],
  settings: PostgresProjectBackupSettings,
): PostgresProjectBackupManifest {
  const backups = snapshots.map(snapshotToBackup).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    version: 1,
    projectId: project.id,
    projectName: project.name,
    latestBackupAt: backups[0]?.createdAt ?? "",
    lastSourceLogAt: backups[0]?.sourceLogAt ?? "",
    retention: settings.retention,
    automaticIntervalMinutes: settings.automaticIntervalMinutes,
    backups,
  };
}

export async function loadPostgresProjectBackupSettings(project: PostgresProject): Promise<PostgresProjectBackupSettings> {
  const raw = await invoke<{
    retention?: Partial<BackupRetentionSettings>;
    automaticIntervalMinutes?: number;
  }>("get_postgres_experiment_project_snapshot_settings_command", {
    projectId: project.id,
  });
  return {
    retention: normalizeRetention(raw.retention),
    automaticIntervalMinutes: normalizeIntervalMinutes(raw.automaticIntervalMinutes),
  };
}

export async function savePostgresProjectBackupSettings(
  project: PostgresProject,
  settings: PostgresProjectBackupSettings,
): Promise<PostgresProjectBackupSettings> {
  const normalized = {
    retention: normalizeRetention(settings.retention),
    automaticIntervalMinutes: normalizeIntervalMinutes(settings.automaticIntervalMinutes),
  };
  const raw = await invoke<{
    retention?: Partial<BackupRetentionSettings>;
    automaticIntervalMinutes?: number;
  }>("save_postgres_experiment_project_snapshot_settings_command", {
    projectId: project.id,
    settings: normalized,
  });
  return {
    retention: normalizeRetention(raw.retention),
    automaticIntervalMinutes: normalizeIntervalMinutes(raw.automaticIntervalMinutes),
  };
}

export async function loadPostgresProjectBackupManifest(project: PostgresProject): Promise<PostgresProjectBackupManifest> {
  const snapshots = await invoke<PostgresProjectSnapshot[]>("list_postgres_experiment_project_snapshots_command", {
    projectId: project.id,
  });
  const settings = await loadPostgresProjectBackupSettings(project);
  return manifestFromSnapshots(project, snapshots, settings);
}

export async function createPostgresProjectBackup(
  project: PostgresProject,
  reason: ProjectBackupReason = "manual",
  sourceLogAt = "",
  sourceLog?: Pick<{ action: string; label: string; occurredAt: string }, "action" | "label" | "occurredAt">,
): Promise<{ entry: PostgresProjectBackupEntry; manifest: PostgresProjectBackupManifest }> {
  const result = await invoke<{ snapshot: PostgresProjectSnapshot }>("create_postgres_experiment_project_snapshot_command", {
    request: {
      projectId: project.id,
      name: reason === "manual" ? "Manual snapshot" : reason === "session" ? "Session snapshot" : "Automatic snapshot",
      reason,
      sourceLogAt: sourceLog?.occurredAt ?? sourceLogAt,
      sourceLogAction: sourceLog?.action ?? "",
      sourceLogLabel: sourceLog?.label ?? "",
    },
  });
  const manifest = reason === "manual"
    ? await loadPostgresProjectBackupManifest(project)
    : await prunePostgresProjectBackups(project);
  return { entry: snapshotToBackup(result.snapshot), manifest };
}

export async function readPostgresProjectBackup(_project: PostgresProject, entry: PostgresProjectBackupEntry) {
  return {
    tables: [
      { name: "project_database_dump", rows: [] },
      { name: "project_storage_files", rows: [] },
    ],
    metadata: {
      projectId: entry.projectId,
      projectName: entry.projectName,
      createdAt: entry.createdAt,
      reason: entry.reason,
    },
  };
}

export async function deletePostgresProjectBackup(
  project: PostgresProject,
  entry: PostgresProjectBackupEntry,
): Promise<PostgresProjectBackupManifest> {
  await invoke("delete_postgres_experiment_project_snapshot_command", {
    request: {
      projectId: project.id,
      snapshotId: entry.id,
    },
  });
  return loadPostgresProjectBackupManifest(project);
}

function bucketKey(date: Date, bucket: "hour" | "day" | "week"): string {
  const copy = new Date(date);
  if (bucket === "hour") return `${copy.getUTCFullYear()}-${copy.getUTCMonth()}-${copy.getUTCDate()}-${copy.getUTCHours()}`;
  if (bucket === "day") return `${copy.getUTCFullYear()}-${copy.getUTCMonth()}-${copy.getUTCDate()}`;
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() - day + 1);
  return `${copy.getUTCFullYear()}-${copy.getUTCMonth()}-${copy.getUTCDate()}`;
}

function bucketStart(date: Date, bucket: "hour" | "day" | "week"): Date {
  const copy = new Date(date);
  if (bucket === "hour") {
    copy.setUTCMinutes(0, 0, 0);
    return copy;
  }
  if (bucket === "day") {
    copy.setUTCHours(0, 0, 0, 0);
    return copy;
  }
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() - day + 1);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

export function postgresBackupDeletionDate(
  entry: PostgresProjectBackupEntry,
  backups: PostgresProjectBackupEntry[],
  retention: BackupRetentionSettings,
): Date | null {
  if (entry.manual) return null;
  const sortedAutomatic = backups
    .filter((backup) => !backup.manual)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (sortedAutomatic[0]?.file === entry.file) return null;

  const created = new Date(entry.createdAt);
  if (Number.isNaN(created.getTime())) return null;

  const hourlyMs = retention.hourlyHours * 60 * 60 * 1000;
  const dailyMs = retention.dailyDays * 24 * 60 * 60 * 1000;
  const weeklyMs = retention.weeklyWeeks * 7 * 24 * 60 * 60 * 1000;
  return new Date(created.getTime() + Math.max(hourlyMs, dailyMs, weeklyMs));
}

export function postgresBackupRetentionStatus(
  entry: PostgresProjectBackupEntry,
  backups: PostgresProjectBackupEntry[],
  retention: BackupRetentionSettings,
  now = new Date(),
): BackupRetentionStatus {
  if (entry.manual) {
    return { category: "manual", bucketStart: null, promotion: null, deletionDate: null };
  }

  const sortedAutomatic = backups
    .filter((backup) => !backup.manual)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const created = new Date(entry.createdAt);
  if (Number.isNaN(created.getTime())) {
    return { category: "pending-delete", bucketStart: null, promotion: null, deletionDate: null };
  }

  const hourKey = bucketKey(created, "hour");
  const dayKey = bucketKey(created, "day");
  const weekKey = bucketKey(created, "week");
  const isFirstInHour = sortedAutomatic.find((backup) => {
    const backupDate = new Date(backup.createdAt);
    return !Number.isNaN(backupDate.getTime()) && bucketKey(backupDate, "hour") === hourKey;
  })?.file === entry.file;
  const isFirstInDay = sortedAutomatic.find((backup) => {
    const backupDate = new Date(backup.createdAt);
    return !Number.isNaN(backupDate.getTime()) && bucketKey(backupDate, "day") === dayKey;
  })?.file === entry.file;
  const isFirstInWeek = sortedAutomatic.find((backup) => {
    const backupDate = new Date(backup.createdAt);
    return !Number.isNaN(backupDate.getTime()) && bucketKey(backupDate, "week") === weekKey;
  })?.file === entry.file;

  if (sortedAutomatic[0]?.file === entry.file) {
    return {
      category: "latest",
      bucketStart: null,
      promotion: isFirstInHour ? "hourly" : null,
      deletionDate: null,
    };
  }

  const ageMs = now.getTime() - created.getTime();
  const ageHours = ageMs / (60 * 60 * 1000);
  const ageDays = ageMs / (24 * 60 * 60 * 1000);

  if (ageHours <= retention.hourlyHours && isFirstInHour) {
    return {
      category: "hourly",
      bucketStart: bucketStart(created, "hour"),
      promotion: isFirstInDay ? "daily" : null,
      deletionDate: new Date(created.getTime() + retention.hourlyHours * 60 * 60 * 1000),
    };
  }
  if (ageDays <= retention.dailyDays && isFirstInDay) {
    return {
      category: "daily",
      bucketStart: bucketStart(created, "day"),
      promotion: isFirstInWeek ? "weekly" : null,
      deletionDate: new Date(created.getTime() + retention.dailyDays * 24 * 60 * 60 * 1000),
    };
  }
  if (ageDays <= retention.weeklyWeeks * 7 && isFirstInWeek) {
    return {
      category: "weekly",
      bucketStart: bucketStart(created, "week"),
      promotion: null,
      deletionDate: new Date(created.getTime() + retention.weeklyWeeks * 7 * 24 * 60 * 60 * 1000),
    };
  }

  return { category: "pending-delete", bucketStart: null, promotion: null, deletionDate: postgresBackupDeletionDate(entry, backups, retention) };
}

function shouldKeepAutomaticBackup(
  entry: PostgresProjectBackupEntry,
  now: Date,
  retention: BackupRetentionSettings,
  usedBuckets: Set<string>,
): boolean {
  const created = new Date(entry.createdAt);
  if (Number.isNaN(created.getTime())) return false;
  const ageMs = now.getTime() - created.getTime();
  const ageHours = ageMs / (60 * 60 * 1000);
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  if (ageHours <= retention.hourlyHours) {
    const key = `h:${bucketKey(created, "hour")}`;
    if (usedBuckets.has(key)) return false;
    usedBuckets.add(key);
    return true;
  }
  if (ageDays <= retention.dailyDays) {
    const key = `d:${bucketKey(created, "day")}`;
    if (usedBuckets.has(key)) return false;
    usedBuckets.add(key);
    return true;
  }
  if (ageDays <= retention.weeklyWeeks * 7) {
    const key = `w:${bucketKey(created, "week")}`;
    if (usedBuckets.has(key)) return false;
    usedBuckets.add(key);
    return true;
  }
  return false;
}

export async function prunePostgresProjectBackups(
  project: PostgresProject,
  currentManifest?: PostgresProjectBackupManifest,
  retentionOverride?: BackupRetentionSettings,
): Promise<PostgresProjectBackupManifest> {
  const manifest = currentManifest ?? await loadPostgresProjectBackupManifest(project);
  const retention = retentionOverride ?? manifest.retention;
  const now = new Date();
  const usedBuckets = new Set<string>();
  let keptNewestAutomatic = false;

  for (const entry of [...manifest.backups].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    if (entry.manual) continue;
    if (!keptNewestAutomatic) {
      keptNewestAutomatic = true;
      continue;
    }
    if (!shouldKeepAutomaticBackup(entry, now, retention, usedBuckets)) {
      try {
        await deletePostgresProjectBackup(project, entry);
      } catch {
        // Retention cleanup should never block active work.
      }
    }
  }
  return loadPostgresProjectBackupManifest(project);
}

export async function shouldCreatePostgresAutomaticBackup(
  project: PostgresProject,
  sourceLogAt: string,
): Promise<boolean> {
  const manifest = await loadPostgresProjectBackupManifest(project);
  if (!manifest.latestBackupAt) return true;
  if (sourceLogAt && sourceLogAt === manifest.lastSourceLogAt) return false;
  const latest = new Date(manifest.latestBackupAt);
  if (Number.isNaN(latest.getTime())) return true;
  return Date.now() - latest.getTime() >= manifest.automaticIntervalMinutes * 60 * 1000;
}

export async function importPostgresProjectBackupAsProject(
  project: PostgresProject,
  entry: PostgresProjectBackupEntry,
  data?: { name?: string; description?: string },
): Promise<PostgresProject> {
  return invoke<PostgresProject>("import_postgres_experiment_project_snapshot_as_project_command", {
    request: {
      projectId: project.id,
      snapshotId: entry.id,
      name: data?.name ?? "",
      description: data?.description ?? "",
    },
  });
}

export function formatPostgresBackupSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = sizeBytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}
