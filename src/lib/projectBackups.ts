import type PocketBase from "pocketbase";
import {
  exists,
  mkdir,
  readTextFile,
  remove,
  stat,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type { Project, ProjectLogEntry } from "../types";
import { getKanqualDataRoot, joinFsPath } from "./dataRoot";
import {
  fetchProjectExportData,
  makeProjectBackupJson,
  parseProjectBackupJson,
  type ProjectBackupReason,
  type ProjectExportData,
} from "./projectExport";

export type BackupRetentionSettings = {
  hourlyHours: number;
  dailyDays: number;
  weeklyWeeks: number;
};

export type ProjectBackupSettings = {
  retention: BackupRetentionSettings;
  automaticIntervalMinutes: number;
};

export type ProjectBackupEntry = {
  file: string;
  createdAt: string;
  reason: ProjectBackupReason;
  manual: boolean;
  projectId: string;
  projectName: string;
  sourceLogAt: string;
  sourceLogAction: string;
  sourceLogLabel: string;
  sizeBytes: number;
};

export type ProjectBackupManifest = {
  version: 1;
  projectId: string;
  projectName: string;
  latestBackupAt: string;
  lastSourceLogAt: string;
  retention: BackupRetentionSettings;
  automaticIntervalMinutes: number;
  backups: ProjectBackupEntry[];
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
const BACKUP_ROOT = "project_backups";
const MANIFEST_FILE = "manifest.json";

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

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "project";
}

async function backupDir(projectId: string): Promise<string> {
  return joinFsPath(await getKanqualDataRoot(), BACKUP_ROOT, safeSegment(projectId));
}

async function manifestPath(projectId: string): Promise<string> {
  return joinFsPath(await backupDir(projectId), MANIFEST_FILE);
}

async function backupPath(projectId: string, file: string): Promise<string> {
  return joinFsPath(await backupDir(projectId), file);
}

function backupFileName(createdAt: string, reason: ProjectBackupReason): string {
  const stamp = createdAt.replace(/[:.]/g, "-");
  return `${stamp}_${reason}.json`;
}

function defaultManifest(project: Project): ProjectBackupManifest {
  return {
    version: 1,
    projectId: project.id,
    projectName: project.name,
    latestBackupAt: "",
    lastSourceLogAt: "",
    retention: DEFAULT_BACKUP_RETENTION,
    automaticIntervalMinutes: DEFAULT_AUTO_BACKUP_INTERVAL_MINUTES,
    backups: [],
  };
}

async function ensureProjectBackupDir(projectId: string): Promise<void> {
  await mkdir(await backupDir(projectId), { recursive: true });
}

function normalizeManifest(project: Project, value: unknown): ProjectBackupManifest {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<ProjectBackupManifest>;
  return {
    version: 1,
    projectId: project.id,
    projectName: project.name,
    latestBackupAt: typeof raw.latestBackupAt === "string" ? raw.latestBackupAt : "",
    lastSourceLogAt: typeof raw.lastSourceLogAt === "string" ? raw.lastSourceLogAt : "",
    retention: normalizeRetention(raw.retention),
    automaticIntervalMinutes: normalizeIntervalMinutes(raw.automaticIntervalMinutes),
    backups: Array.isArray(raw.backups)
      ? raw.backups
          .filter((entry): entry is ProjectBackupEntry => {
            const candidate = entry as Partial<ProjectBackupEntry>;
            return typeof candidate.file === "string" && typeof candidate.createdAt === "string";
          })
          .map((entry) => ({
            file: entry.file,
            createdAt: entry.createdAt,
            reason: normalizeReason(entry.reason),
            manual: Boolean(entry.manual),
            projectId: project.id,
            projectName: typeof entry.projectName === "string" ? entry.projectName : project.name,
            sourceLogAt: typeof entry.sourceLogAt === "string" ? entry.sourceLogAt : "",
            sourceLogAction: typeof entry.sourceLogAction === "string" ? entry.sourceLogAction : "",
            sourceLogLabel: typeof entry.sourceLogLabel === "string" ? entry.sourceLogLabel : "",
            sizeBytes: Number.isFinite(entry.sizeBytes) ? Number(entry.sizeBytes) : 0,
          }))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      : [],
  };
}

export async function loadProjectBackupManifest(project: Project): Promise<ProjectBackupManifest> {
  try {
    const path = await manifestPath(project.id);
    if (!(await exists(path))) return defaultManifest(project);
    return normalizeManifest(project, JSON.parse(await readTextFile(path)));
  } catch {
    return defaultManifest(project);
  }
}

async function saveProjectBackupManifest(manifest: ProjectBackupManifest): Promise<void> {
  await ensureProjectBackupDir(manifest.projectId);
  await writeTextFile(await manifestPath(manifest.projectId), JSON.stringify(manifest, null, 2));
}

export async function saveProjectBackupSettings(
  project: Project,
  settings: ProjectBackupSettings,
): Promise<ProjectBackupManifest> {
  const manifest = await loadProjectBackupManifest(project);
  manifest.retention = normalizeRetention(settings.retention);
  manifest.automaticIntervalMinutes = normalizeIntervalMinutes(settings.automaticIntervalMinutes);
  await saveProjectBackupManifest(manifest);
  return pruneProjectBackups(project, manifest);
}

function bucketKey(date: Date, bucket: "hour" | "day" | "week"): string {
  const copy = new Date(date);
  if (bucket === "hour") {
    return `${copy.getUTCFullYear()}-${copy.getUTCMonth()}-${copy.getUTCDate()}-${copy.getUTCHours()}`;
  }
  if (bucket === "day") {
    return `${copy.getUTCFullYear()}-${copy.getUTCMonth()}-${copy.getUTCDate()}`;
  }
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() - day + 1);
  return `${copy.getUTCFullYear()}-${copy.getUTCMonth()}-${copy.getUTCDate()}`;
}

function bucketStart(date: Date, bucket: "hour" | "day" | "week"): Date {
  const copy = new Date(date);
  if (bucket === "hour") {
    copy.setMinutes(0, 0, 0);
    return copy;
  }
  if (bucket === "day") {
    copy.setHours(0, 0, 0, 0);
    return copy;
  }
  const day = copy.getDay() || 7;
  copy.setDate(copy.getDate() - day + 1);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function shouldKeepAutomaticBackup(
  entry: ProjectBackupEntry,
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

export async function pruneProjectBackups(
  project: Project,
  currentManifest?: ProjectBackupManifest,
): Promise<ProjectBackupManifest> {
  const manifest = currentManifest ?? await loadProjectBackupManifest(project);
  const now = new Date();
  const usedBuckets = new Set<string>();
  let keptNewestAutomatic = false;
  const kept: ProjectBackupEntry[] = [];
  const removed: ProjectBackupEntry[] = [];

  for (const entry of [...manifest.backups].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    if (entry.manual) {
      kept.push(entry);
      continue;
    }
    if (!keptNewestAutomatic) {
      keptNewestAutomatic = true;
      kept.push(entry);
      continue;
    }
    if (shouldKeepAutomaticBackup(entry, now, manifest.retention, usedBuckets)) {
      kept.push(entry);
    } else {
      removed.push(entry);
    }
  }

  for (const entry of removed) {
    try {
      await remove(await backupPath(project.id, entry.file));
    } catch {
      // Retention cleanup should never block the active project.
    }
  }

  manifest.backups = kept.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  manifest.latestBackupAt = manifest.backups[0]?.createdAt ?? "";
  manifest.lastSourceLogAt = manifest.backups[0]?.sourceLogAt ?? "";
  await saveProjectBackupManifest(manifest);
  return manifest;
}

export async function createProjectBackup(
  pb: PocketBase,
  project: Project,
  reason: ProjectBackupReason,
  sourceLogAt = "",
  sourceLog?: Pick<ProjectLogEntry, "action" | "label" | "occurredAt">,
): Promise<{ entry: ProjectBackupEntry; manifest: ProjectBackupManifest }> {
  await ensureProjectBackupDir(project.id);
  const data = await fetchProjectExportData(pb, project);
  const createdAt = new Date().toISOString();
  const file = backupFileName(createdAt, reason);
  const path = await backupPath(project.id, file);
  await writeTextFile(path, makeProjectBackupJson(data, reason));

  let sizeBytes = 0;
  try {
    const info = await stat(path);
    sizeBytes = info.size;
  } catch {
    sizeBytes = new Blob([makeProjectBackupJson(data, reason)]).size;
  }

  const manifest = await loadProjectBackupManifest(project);
  const entry: ProjectBackupEntry = {
    file,
    createdAt,
    reason,
    manual: reason === "manual",
    projectId: project.id,
    projectName: project.name,
    sourceLogAt: sourceLog?.occurredAt ?? sourceLogAt,
    sourceLogAction: sourceLog?.action ?? "",
    sourceLogLabel: sourceLog?.label ?? "",
    sizeBytes,
  };

  manifest.projectName = project.name;
  manifest.backups = [entry, ...manifest.backups.filter((backup) => backup.file !== file)]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  manifest.latestBackupAt = manifest.backups[0]?.createdAt ?? createdAt;
  manifest.lastSourceLogAt = entry.sourceLogAt || manifest.lastSourceLogAt;
  await saveProjectBackupManifest(manifest);

  const prunedManifest = reason === "manual" ? manifest : await pruneProjectBackups(project, manifest);
  return { entry, manifest: prunedManifest };
}

export async function shouldCreateAutomaticBackup(
  project: Project,
  sourceLogAt: string,
): Promise<boolean> {
  const manifest = await loadProjectBackupManifest(project);
  if (!manifest.latestBackupAt) return true;
  if (sourceLogAt && sourceLogAt === manifest.lastSourceLogAt) return false;
  const latest = new Date(manifest.latestBackupAt);
  if (Number.isNaN(latest.getTime())) return true;
  return Date.now() - latest.getTime() >= manifest.automaticIntervalMinutes * 60 * 1000;
}

export async function readProjectBackup(
  project: Project,
  entry: ProjectBackupEntry,
): Promise<ProjectExportData> {
  return parseProjectBackupJson(await readTextFile(await backupPath(project.id, entry.file)));
}

export async function deleteManualProjectBackup(
  project: Project,
  entry: ProjectBackupEntry,
): Promise<ProjectBackupManifest> {
  if (!entry.manual) {
    throw new Error("Automatic backups are retained based on backup settings.");
  }

  const manifest = await loadProjectBackupManifest(project);
  const path = await backupPath(project.id, entry.file);
  if (await exists(path)) {
    await remove(path);
  }

  manifest.backups = manifest.backups
    .filter((backup) => backup.file !== entry.file)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  manifest.latestBackupAt = manifest.backups[0]?.createdAt ?? "";
  manifest.lastSourceLogAt = manifest.backups[0]?.sourceLogAt ?? "";
  await saveProjectBackupManifest(manifest);
  return manifest;
}

export function backupDisplayReason(reason: ProjectBackupReason): string {
  if (reason === "manual") return "Manual";
  if (reason === "session") return "Session";
  return "Automatic";
}

export function formatBackupSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "";
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function backupDeletionDate(
  entry: ProjectBackupEntry,
  backups: ProjectBackupEntry[],
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

export function backupRetentionStatus(
  entry: ProjectBackupEntry,
  backups: ProjectBackupEntry[],
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

  return { category: "pending-delete", bucketStart: null, promotion: null, deletionDate: backupDeletionDate(entry, backups, retention) };
}
