import { useState, useCallback, useMemo, useEffect, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readDir, stat } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAuth } from "../context/AuthContext";
import { useStore } from "../context/StoreContext";
import { LOCALE_LABELS, SUPPORTED_LOCALES } from "../i18n";
import { useI18n } from "../i18n/provider";
import { formatCurrentDateTime, formatCurrentNumber } from "../i18n/formatters";
import {
  clearRecentProjects,
  formatBytes,
  readAppSettings,
  saveAppSettings,
  type AppSettings,
} from "../lib/appSettings";
import { clearLocalAccounts, clearRemoteSessions } from "../lib/authHistory";
import { getAppRuntimeInfo, joinFsPath, type AppRuntimeInfo } from "../lib/dataRoot";
import {
  bootstrapPostgres,
  createPostgresProject,
  ensurePostgresSchema,
  getPostgresStatus,
  listPostgresProjects,
  type BootstrapPostgresResult,
  type PostgresProject,
  type PostgresStatus,
  type PostgresSchemaMigrationResult,
} from "../lib/postgres";
import {
  clearAppDataRecords,
  deleteUserAccount,
  listRegisteredUserAccounts,
  type RegisteredUserAccount,
} from "../lib/pb";
import { isLocalBackendUrl } from "../lib/aiJobs";
import { buildPermissionMatrixRows, type PermissionMatrixRow } from "../lib/permissionMatrix";
import thirdPartyNoticesRaw from "../../THIRD_PARTY_NOTICES.md?raw";
import { HelpIcon } from "../components/AppIcons";

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
const GITHUB_RELEASES_URL = "https://github.com/KanQual/kanqual/releases";

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

function shouldShowAppAutoSaveNotice(sectionId: string) {
  return ["startup", "language", "import", "privacy", "updates", "llm"].includes(sectionId);
}

function formatStorageFileSummary(
  count: number,
  directory: string,
  t: ReturnType<typeof useI18n>["t"],
): string {
  return t("appSettings.storage.filesInDirectory", {
    count: formatCurrentNumber(count),
    directory,
  });
}

type PingStatus = "idle" | "loading" | "success" | "error";
interface PingResult { status: PingStatus; ms?: number; error?: string; }

function PingBadge({ result }: { result: PingResult }) {
  if (result.status === "idle")    return <span className="ping-badge ping-badge--idle">Not tested</span>;
  if (result.status === "loading") return <span className="ping-badge ping-badge--idle">Testing...</span>;
  if (result.status === "success") return <span className="ping-badge ping-badge--ok">Server Reachable &nbsp;{result.ms} ms</span>;
  return (
    <span className="ping-badge ping-badge--error">
      Server Unreachable{result.error && <> {result.error}</>}
    </span>
  );
}

export function AddressCard({
  label, description, host, port, loading, ping, disabled, onTest,
}: {
  label: string; description: string; host: string | null; port: number;
  loading?: boolean; ping: PingResult; disabled?: boolean; onTest: () => void;
}) {
  const address = host ? `http://${host}:${port}` : null;
  return (
    <div className="settings-row settings-row--block">
      <div className="settings-row-info">
        <div className="settings-row-label">{label}</div>
        <div className="settings-row-desc">{description}</div>
        <div style={{ marginTop: 8 }}>
          <PingBadge result={ping} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
        <code className="settings-code-line" style={{ minWidth: 220 }}>
          {loading ? "Detecting..." : (address ?? "Unavailable")}
        </code>
        <button className="btn btn--sm" disabled={!address} onClick={() => address && navigator.clipboard.writeText(address).catch(() => {})}>
          Copy
        </button>
        <button className="btn btn--sm btn--primary" disabled={!address || disabled || ping.status === "loading"} onClick={onTest}>
          {ping.status === "loading" ? "Testing..." : "Test"}
        </button>
      </div>
    </div>
  );
}

function CollaborationPingBadge({
  result,
  scope,
}: {
  result: PingResult;
  scope: "local" | "internet";
}) {
  const { t } = useI18n();
  if (result.status === "idle") return <span className="ping-badge ping-badge--idle">{t("appSettings.network.notTested")}</span>;
  if (result.status === "loading") return <span className="ping-badge ping-badge--idle">{t("appSettings.network.testing")}</span>;
  if (result.status === "success") {
    return (
      <span className="ping-badge ping-badge--ok">
        {scope === "local"
          ? t("appSettings.network.localReachable")
          : t("appSettings.network.internetReachable")}
        {typeof result.ms === "number" && <> {result.ms} ms</>}
      </span>
    );
  }
  return (
    <span className="ping-badge ping-badge--error">
      {scope === "local"
        ? t("appSettings.network.localUnreachable")
        : t("appSettings.network.internetUnreachable")}
      {result.error && <> - {result.error}</>}
    </span>
  );
}

function CollaborationAddressCard({
  label,
  description,
  host,
  port,
  loading,
  ping,
  disabled,
  onTest,
  scope,
}: {
  label: string;
  description: string;
  host: string | null;
  port: number;
  loading?: boolean;
  ping: PingResult;
  disabled?: boolean;
  onTest: () => void;
  scope: "local" | "internet";
}) {
  const { t } = useI18n();
  const address = host ? `http://${host}:${port}` : null;
  return (
    <div className="settings-row settings-row--block">
      <div className="settings-row-info">
        <div className="settings-row-label">{label}</div>
        <div className="settings-row-desc">{description}</div>
        <div style={{ marginTop: 8 }}>
          <CollaborationPingBadge result={ping} scope={scope} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
        <code className="settings-code-line" style={{ minWidth: 220 }}>
          {loading ? t("appSettings.network.detecting") : (address ?? t("appSettings.network.unavailable"))}
        </code>
        <button className="btn btn--sm" disabled={!address} onClick={() => address && navigator.clipboard.writeText(address).catch(() => {})}>
          {t("appSettings.network.copy")}
        </button>
        <button className="btn btn--sm btn--primary" disabled={!address || disabled || ping.status === "loading"} onClick={onTest}>
          {ping.status === "loading" ? t("appSettings.network.testing") : t("appSettings.network.test")}
        </button>
      </div>
    </div>
  );
}

type AppInfo = AppRuntimeInfo;

type EmbeddingModelStatus = {
  installed: boolean;
  repoId: string;
  displayName: string;
  modelDir: string;
  files: number;
  bytes: number;
  downloadedAtMs: number | null;
};

type EmbeddingModelDownloadStatus = {
  phase: "idle" | "downloading" | "cancelling" | "cancelled" | "completed" | "error";
  downloadedBytes: number;
  totalBytes: number | null;
  downloadedFiles: number;
  totalFiles: number;
  currentFile: string | null;
  progressPercent: number | null;
  message: string | null;
};

type EmbeddingModelDownloadPreflight = {
  installed: boolean;
  modelDir: string;
  totalBytes: number;
  existingBytes: number;
  remainingBytes: number;
  totalFiles: number | null;
  existingFiles: number;
  remainingFiles: number | null;
  manifestAvailable: boolean;
  message: string | null;
};

type OllamaModelSummary = {
  name: string;
  size: number | null;
  modifiedAt: string | null;
  digest: string | null;
  parameterSize: string | null;
  quantizationLevel: string | null;
};

type OllamaDiscoveryResult = {
  ok: boolean;
  baseUrl: string;
  version: string | null;
  modelCount: number;
  models: OllamaModelSummary[];
  message: string;
};

type DirectoryStats = {
  bytes: number;
  files: number;
};

async function readDirectoryStats(path: string): Promise<DirectoryStats> {
  try {
    const entries = await readDir(path);
    let bytes = 0;
    let files = 0;
    for (const entry of entries as Array<{ name?: string; isDirectory?: boolean }>) {
      if (!entry.name) continue;
      const childPath = joinFsPath(path, entry.name);
      if (entry.isDirectory) {
        const child = await readDirectoryStats(childPath);
        bytes += child.bytes;
        files += child.files;
      } else {
        const info = await stat(childPath);
        bytes += info.size ?? 0;
        files += 1;
      }
    }
    return { bytes, files };
  } catch {
    return { bytes: 0, files: 0 };
  }
}

function formatDownloadDate(value: number | null | undefined): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return formatCurrentDateTime(date, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatAdminDateTime(
  value: string | null | undefined,
  fallbackLabel: string,
  formatDateTime: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) => string,
): string {
  if (!value) return fallbackLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallbackLabel;
  return formatDateTime(date, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatCompletionStatus(status: EmbeddingModelDownloadStatus | null, modelStatus: EmbeddingModelStatus | null): string {
  if (status?.phase === "downloading") return "Downloading";
  if (status?.phase === "cancelling") return "Cancelling";
  if (status?.phase === "cancelled") return "Cancelled";
  if (status?.phase === "completed") return "Completed";
  if (status?.phase === "error") return "Failed";
  if (modelStatus?.installed) return "Completed";
  return "Not started";
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

async function loadRegisteredUserActivityData(pb: NonNullable<ReturnType<typeof useAuth>["pb"]>) {
  const [presenceResult, logResult] = await Promise.allSettled([
    pb.collection("project_presence").getFullList({ sort: "-last_seen" }),
    pb.collection("project_log").getFullList({
      filter: 'action="project.open"',
      sort: "-occurred_at",
    }),
  ]);

  return {
    presenceRecords: presenceResult.status === "fulfilled" ? presenceResult.value : [],
    logRecords: logResult.status === "fulfilled" ? logResult.value : [],
    activityWarning:
      presenceResult.status === "rejected" || logResult.status === "rejected"
        ? "User activity details are temporarily unavailable, but registered users can still be managed."
        : "",
  };
}

export function AppSettingsView() {
  const { locale, setLocale, t, formatDateTime } = useI18n();
  const { pb, user, logout } = useAuth();
  const {
    networkMode,
    setNetworkMode,
    setView,
    activeProject,
    canCurrentUser,
    embeddingModelDownloadStatus,
    startEmbeddingModelDownload,
    cancelEmbeddingModelDownload,
  } = useStore();
  const [settings, setSettings] = useState<AppSettings>(readAppSettings);
  const [notice, setNotice] = useState("");
  const [networkSwitching, setNetworkSwitching] = useState(false);
  const [confirmEnableNetworkMode, setConfirmEnableNetworkMode] = useState(false);
  const [localIp, setLocalIp] = useState<string | null>(null);
  const [localIpError, setLocalIpError] = useState(false);
  const [externalIp, setExternalIp] = useState<string | null>(null);
  const [externalIpLoading, setExternalIpLoading] = useState(true);
  const [localPing, setLocalPing] = useState<PingResult>({ status: "idle" });
  const [externalPing, setExternalPing] = useState<PingResult>({ status: "idle" });
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [dbHealth, setDbHealth] = useState<"checking" | "ok" | "error">("checking");
  const [postgresStatus, setPostgresStatus] = useState<PostgresStatus | null>(null);
  const [postgresBusy, setPostgresBusy] = useState(false);
  const [postgresError, setPostgresError] = useState("");
  const [postgresNotice, setPostgresNotice] = useState("");
  const [postgresSuperuserPassword, setPostgresSuperuserPassword] = useState("");
  const [postgresBootstrapResult, setPostgresBootstrapResult] = useState<BootstrapPostgresResult | null>(null);
  const [postgresSchemaResult, setPostgresSchemaResult] = useState<PostgresSchemaMigrationResult | null>(null);
  const [postgresProjects, setPostgresProjects] = useState<PostgresProject[]>([]);
  const [postgresProjectName, setPostgresProjectName] = useState("");
  const [postgresProjectDescription, setPostgresProjectDescription] = useState("");
  const [storageBusy, setStorageBusy] = useState(false);
  const [storageSummary, setStorageSummary] = useState({
    databaseBytes: 0,
    databaseFiles: 0,
    backupBytes: 0,
    backupFiles: 0,
  });
  const [activeSettingsModal, setActiveSettingsModal] = useState<string | null>(null);
  const [embeddingModelError, setEmbeddingModelError] = useState("");
  const [embeddingModelNotice, setEmbeddingModelNotice] = useState("");
  const [embeddingModelStatus, setEmbeddingModelStatus] = useState<EmbeddingModelStatus | null>(null);
  const [embeddingModelPreflight, setEmbeddingModelPreflight] = useState<EmbeddingModelDownloadPreflight | null>(null);
  const [ollamaBusy, setOllamaBusy] = useState(false);
  const [ollamaError, setOllamaError] = useState("");
  const [ollamaNotice, setOllamaNotice] = useState("");
  const [ollamaDiscovery, setOllamaDiscovery] = useState<OllamaDiscoveryResult | null>(null);
  const [ollamaModels, setOllamaModels] = useState<OllamaModelSummary[]>([]);
  const [aboutCardExpanded, setAboutCardExpanded] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [registeredUsers, setRegisteredUsers] = useState<RegisteredUserAccount[]>([]);
  const [registeredUserActivity, setRegisteredUserActivity] = useState<Record<string, { active: boolean; lastLoginAt: string | null }>>({});
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminNotice, setAdminNotice] = useState("");
  const canOpenAppSettings = canCurrentUser("openAppSettings");
  const canViewLicensingInfo = canCurrentUser("viewLicensingInfo");
  const canChangeStartupSettings = canCurrentUser("changeStartupSettings");
  const canManageLlmSettings = canCurrentUser("manageLlmSettings");
  const canDownloadEmbeddingModel = canCurrentUser("downloadEmbeddingModel");
  const canDeleteEmbeddingModel = canCurrentUser("deleteEmbeddingModel");
  const canViewLocalUsers = canCurrentUser("viewLocalUsers");
  const canDeleteLocalUsers = canCurrentUser("deleteLocalUsers");
  const canClearLocalAppData = canCurrentUser("clearLocalAppData");
  const canAccessAdministration =
    canViewLocalUsers || canDeleteLocalUsers || canClearLocalAppData;
  const embeddingModelBusy =
    embeddingModelDownloadStatus?.phase === "downloading" ||
    embeddingModelDownloadStatus?.phase === "cancelling";

  const settingsOverviewCards = [
    {
      id: "startup",
      title: t("appSettings.sectionTitles.startup"),
      description: t("appSettings.overview.startup"),
      visible: canChangeStartupSettings,
      tone: "default" as const,
    },
    {
      id: "language",
      title: t("appSettings.sectionTitles.language"),
      description: t("appSettings.overview.language"),
      visible: canOpenAppSettings,
      tone: "default" as const,
    },
    {
      id: "import",
      title: t("appSettings.sectionTitles.documentImport"),
      description: t("appSettings.overview.documentImport"),
      visible: canOpenAppSettings,
      tone: "default" as const,
    },
    {
      id: "privacy",
      title: t("appSettings.sectionTitles.privacy"),
      description: t("appSettings.overview.privacy"),
      visible: canOpenAppSettings,
      tone: "default" as const,
    },
    {
      id: "storage",
      title: t("appSettings.storage.localStorageTitle"),
      description: t("appSettings.overview.storage"),
      visible: canOpenAppSettings,
      tone: "default" as const,
    },
    {
      id: "updates",
      title: t("appSettings.updates.title"),
      description: t("appSettings.overview.updates"),
      visible: canOpenAppSettings,
      tone: "default" as const,
    },
    {
      id: "diagnostics",
      title: t("appSettings.sectionTitles.diagnostics"),
      description: t("appSettings.overview.diagnostics"),
      visible: canOpenAppSettings,
      tone: "default" as const,
    },
    {
      id: "permissions",
      title: t("appSettings.permissions.title"),
      description: t("appSettings.permissions.description"),
      visible: canOpenAppSettings,
      tone: "default" as const,
    },
    {
      id: "network",
      title: t("appSettings.sectionTitles.network"),
      description: t("appSettings.overview.network"),
      visible: canOpenAppSettings,
      tone: "network" as const,
    },
    ...(canAccessAdministration
      ? [{
          id: "administration",
          title: t("appSettings.admin.title"),
          description: t("appSettings.admin.description"),
          visible: true,
          tone: "admin" as const,
        }]
      : []),
  ].filter((card) => card.visible);

  const appSettingsCardById = new Map(settingsOverviewCards.map((card) => [card.id, card]));
  const appSettingsSections = [
    {
      id: "everyday",
      sectionHeading: t("appSettings.overviewSections.everyday.eyebrow"),
      cardIds: ["startup", "language", "import"],
    },
    {
      id: "privacy-data",
      sectionHeading: t("appSettings.overviewSections.privacy.eyebrow"),
      cardIds: ["privacy", "storage"],
    },
    {
      id: "maintenance",
      sectionHeading: t("appSettings.overviewSections.maintenance.eyebrow"),
      cardIds: ["updates", "diagnostics"],
    },
    {
      id: "advanced",
      sectionHeading: t("appSettings.overviewSections.advanced.eyebrow"),
      cardIds: ["permissions", "network", "administration"],
    },
  ]
    .map((section) => ({
      ...section,
      cards: section.cardIds
        .map((cardId) => appSettingsCardById.get(cardId))
        .filter((card): card is NonNullable<typeof card> => Boolean(card)),
    }))
    .filter((section) => section.cards.length > 0);

  const registeredUserTableRows = useMemo(() => {
    return registeredUsers.map((entry) => {
      const activity = registeredUserActivity[entry.id] ?? { active: entry.id === user?.id, lastLoginAt: null };
      return {
        id: entry.id,
        name: String(entry.name || entry.email || "Unnamed user"),
        email: String(entry.email || "No email"),
        active: activity.active || entry.id === user?.id,
        lastLoginAt: activity.lastLoginAt,
        isCurrentUser: entry.id === user?.id,
      };
    });
  }, [registeredUserActivity, registeredUsers, user]);

  const openRequestedSettingsModal = useCallback(() => {
    const requestedModal = sessionStorage.getItem("kanqual:open-app-settings-modal");
    if (!requestedModal) return;
    sessionStorage.removeItem("kanqual:open-app-settings-modal");
    if (settingsOverviewCards.some((card) => card.id === requestedModal)) {
      setActiveSettingsModal(requestedModal);
    }
  }, [settingsOverviewCards]);

  const permissionMatrixRowsForLocale = buildPermissionMatrixRows(t);

  const permissionMatrixByCategory = permissionMatrixRowsForLocale.reduce<Record<string, PermissionMatrixRow[]>>((acc, row) => {
    if (!acc[row.category]) acc[row.category] = [];
    acc[row.category].push(row);
    return acc;
  }, {});

  useEffect(() => {
    invoke<string>("get_local_ip").then(setLocalIp).catch(() => setLocalIpError(true));
    setExternalIpLoading(true);
    fetch("https://api.ipify.org?format=json")
      .then((r) => r.json())
      .then((d: { ip: string }) => { setExternalIp(d.ip); setExternalIpLoading(false); })
      .catch(() => { setExternalIp(null); setExternalIpLoading(false); });
  }, []);

  async function testLocalPing() {
    if (!localIp) return;
    setLocalPing({ status: "loading" });
    try {
      const ms = await invoke<number>("ping_address", { host: localIp, port: 8090 });
      setLocalPing({ status: "success", ms });
    } catch (e) {
      setLocalPing({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  async function testExternalPing() {
    if (!externalIp) return;
    setExternalPing({ status: "loading" });
    try {
      const ms = await invoke<number>("ping_address", { host: externalIp, port: 8090 });
      setExternalPing({ status: "success", ms });
    } catch (e) {
      setExternalPing({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  async function applyNetworkMode(mode: "local" | "lan") {
    if (mode === networkMode || networkSwitching) return;
    setNetworkSwitching(true);
    setNotice("");
    try {
      await setNetworkMode(mode);
      setNotice(
        mode === "lan"
          ? `LAN mode enabled for this session. Other devices can connect at http://${localIp ?? "your-ip"}:8090 until the app closes.`
          : "Local-only mode restored for this session."
      );
    } catch (e) {
      setNotice(`Failed to switch mode: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setNetworkSwitching(false);
    }
  }

  async function handleNetworkModeToggle(mode: "local" | "lan") {
    if (mode === networkMode || networkSwitching) return;
    if (mode === "lan" && networkMode !== "lan") {
      setConfirmEnableNetworkMode(true);
      return;
    }
    await applyNetworkMode(mode);
  }

  async function handleConfirmEnableNetworkMode() {
    setConfirmEnableNetworkMode(false);
    await applyNetworkMode("lan");
  }

  function persist(next: AppSettings, message: string) {
    setSettings(next);
    saveAppSettings(next);
    setNotice(message);
  }

  const refreshPostgres = useCallback(async () => {
    try {
      const status = await getPostgresStatus();
      setPostgresStatus(status);
      setPostgresError("");
    } catch (error) {
      console.error("Failed to load Postgres status:", error);
      setPostgresError("Could not load PostgreSQL status.");
    }
  }, []);

  const refreshPostgresProjects = useCallback(async () => {
    try {
      const projects = await listPostgresProjects();
      setPostgresProjects(projects);
    } catch (error) {
      console.error("Failed to load Postgres projects:", error);
      setPostgresProjects([]);
    }
  }, []);

  async function handleBootstrapPostgres() {
    setPostgresBusy(true);
    setPostgresError("");
    setPostgresNotice("");
    try {
      const result = await bootstrapPostgres(postgresSuperuserPassword);
      setPostgresBootstrapResult(result);
      setPostgresSchemaResult(null);
      setPostgresProjects([]);
      setPostgresNotice(
        result.appRoleReady
          ? `Created or updated ${result.appRoleName} and verified access to ${result.appDatabase}.`
          : `Created or updated ${result.appRoleName}, but the app-role verification step still needs review.`,
      );
      setPostgresSuperuserPassword("");
      await refreshPostgres();
    } catch (error) {
      console.error("Postgres bootstrap failed:", error);
      setPostgresError(error instanceof Error ? error.message : String(error));
    } finally {
      setPostgresBusy(false);
    }
  }

  async function handleEnsurePostgresSchema() {
    setPostgresBusy(true);
    setPostgresError("");
    try {
      const result = await ensurePostgresSchema();
      setPostgresSchemaResult(result);
      setPostgresNotice(`PostgreSQL schema ready. Applied versions: ${result.appliedVersions.join(", ") || "none"}.`);
      await refreshPostgresProjects();
    } catch (error) {
      console.error("Postgres schema failed:", error);
      setPostgresError(error instanceof Error ? error.message : String(error));
    } finally {
      setPostgresBusy(false);
    }
  }

  async function handleCreatePostgresProject() {
    setPostgresBusy(true);
    setPostgresError("");
    try {
      const created = await createPostgresProject({
        name: postgresProjectName,
        description: postgresProjectDescription,
      });
      setPostgresProjectName("");
      setPostgresProjectDescription("");
      setPostgresNotice(`Created PostgreSQL project "${created.name}".`);
      await refreshPostgresProjects();
    } catch (error) {
      console.error("Postgres project creation failed:", error);
      setPostgresError(error instanceof Error ? error.message : String(error));
    } finally {
      setPostgresBusy(false);
    }
  }

  async function refreshDiagnostics() {
    setStorageBusy(true);
    setDbHealth("checking");
    try {
      const info = await getAppRuntimeInfo();
      const [databaseStats, backupStats] = await Promise.all([
        readDirectoryStats(joinFsPath(info.appDataDir, "pb_data")),
        readDirectoryStats(joinFsPath(info.appDataDir, "project_backups")),
      ]);
      setAppInfo(info);
      setStorageSummary({
        databaseBytes: databaseStats.bytes,
        databaseFiles: databaseStats.files,
        backupBytes: backupStats.bytes,
        backupFiles: backupStats.files,
      });
    } finally {
      setStorageBusy(false);
    }

    if (!pb) {
      setDbHealth("error");
      await refreshPostgres();
      return;
    }
    try {
      await pb.health.check();
      setDbHealth("ok");
    } catch {
      setDbHealth("error");
    }

    await refreshPostgres();
  }

  useEffect(() => {
    void refreshDiagnostics();
  }, [pb]);

  const refreshEmbeddingModelStatus = useCallback(() => {
    invoke<EmbeddingModelStatus>("get_multilingual_e5_status")
      .then((status) => {
        setEmbeddingModelStatus(status);
        setEmbeddingModelError("");
      })
      .catch((error) => {
        console.error("Failed to load embedding model status:", error);
        setEmbeddingModelError("Could not load embedding model status.");
      });
  }, []);

  const refreshEmbeddingModelPreflight = useCallback(() => {
    invoke<EmbeddingModelDownloadPreflight>("get_multilingual_e5_download_preflight")
      .then((preflight) => {
        setEmbeddingModelPreflight(preflight);
      })
      .catch((error) => {
        console.error("Failed to load embedding model preflight:", error);
      });
  }, []);

  useEffect(() => {
    refreshEmbeddingModelStatus();
    refreshEmbeddingModelPreflight();
  }, [refreshEmbeddingModelStatus, refreshEmbeddingModelPreflight]);

  useEffect(() => {
    openRequestedSettingsModal();
  }, [openRequestedSettingsModal]);

  useEffect(() => {
    function handleOpenRequestedSettingsModal() {
      openRequestedSettingsModal();
    }

    window.addEventListener("kanqual:open-app-settings-modal", handleOpenRequestedSettingsModal);
    return () => {
      window.removeEventListener("kanqual:open-app-settings-modal", handleOpenRequestedSettingsModal);
    };
  }, [openRequestedSettingsModal]);

  useEffect(() => {
    const phase = embeddingModelDownloadStatus?.phase;
    if (!phase || phase === "idle" || phase === "downloading" || phase === "cancelling") return;
    refreshEmbeddingModelStatus();
    refreshEmbeddingModelPreflight();
  }, [embeddingModelDownloadStatus?.phase, refreshEmbeddingModelStatus, refreshEmbeddingModelPreflight]);

  useEffect(() => {
    if (activeSettingsModal !== "llm") return;
    refreshEmbeddingModelPreflight();
  }, [activeSettingsModal, refreshEmbeddingModelPreflight]);

  useEffect(() => {
    if (activeSettingsModal !== "administration" || !pb || !canViewLocalUsers) return;
    const currentPb = pb;
    let cancelled = false;

    async function loadRegisteredUsers() {
      setAdminBusy(true);
      try {
        const userRecordsPromise = isLocalBackendUrl(currentPb.baseURL)
          ? listRegisteredUserAccounts(currentPb)
          : currentPb.collection("users").getFullList<RegisteredUserAccount>({ sort: "created" });
        const [records, activityData] = await Promise.all([
          userRecordsPromise,
          loadRegisteredUserActivityData(currentPb),
        ]);
        if (!cancelled) {
          setRegisteredUsers(records);
          const { presenceRecords, logRecords, activityWarning } = activityData;
          const nowMs = Date.now();
          const nextActivity: Record<string, { active: boolean; lastLoginAt: string | null }> = {};

          for (const record of records) {
            nextActivity[record.id] = {
              active: record.id === user?.id,
              lastLoginAt: null,
            };
          }

          for (const record of presenceRecords) {
            const userId = typeof record.user === "string" ? record.user : "";
            const lastSeen = typeof record.last_seen === "string" ? record.last_seen : "";
            if (!userId || !lastSeen) continue;
            const lastSeenMs = Date.parse(lastSeen);
            if (!Number.isFinite(lastSeenMs)) continue;
            if (lastSeenMs >= nowMs - 45_000) {
              nextActivity[userId] = {
                active: true,
                lastLoginAt: nextActivity[userId]?.lastLoginAt ?? null,
              };
            }
          }

          for (const record of logRecords) {
            const userId = typeof record.user === "string" ? record.user : "";
            const occurredAt = typeof record.occurred_at === "string" ? record.occurred_at : "";
            if (!userId || !occurredAt) continue;
            if (!nextActivity[userId]) {
              nextActivity[userId] = { active: false, lastLoginAt: occurredAt };
              continue;
            }
            if (!nextActivity[userId].lastLoginAt) {
              nextActivity[userId] = {
                ...nextActivity[userId],
                lastLoginAt: occurredAt,
              };
            }
          }

          setRegisteredUserActivity(nextActivity);
          setAdminNotice(activityWarning);
        }
      } catch (error) {
        if (!cancelled) {
          setAdminNotice(error instanceof Error ? error.message : "Could not load registered users.");
        }
      } finally {
        if (!cancelled) {
          setAdminBusy(false);
        }
      }
    }

    void loadRegisteredUsers();
    return () => {
      cancelled = true;
    };
  }, [activeSettingsModal, pb, canViewLocalUsers, user?.id]);

  async function refreshRegisteredUsers() {
    if (!pb || !canViewLocalUsers) return;
    const userRecordsPromise = isLocalBackendUrl(pb.baseURL)
      ? listRegisteredUserAccounts(pb)
      : pb.collection("users").getFullList<RegisteredUserAccount>({ sort: "created" });
    const [records, activityData] = await Promise.all([
      userRecordsPromise,
      loadRegisteredUserActivityData(pb),
    ]);
    const { presenceRecords, logRecords, activityWarning } = activityData;
    setRegisteredUsers(records);
    const nowMs = Date.now();
    const nextActivity: Record<string, { active: boolean; lastLoginAt: string | null }> = {};
    for (const record of records) {
      nextActivity[record.id] = {
        active: record.id === user?.id,
        lastLoginAt: null,
      };
    }
    for (const record of presenceRecords) {
      const userId = typeof record.user === "string" ? record.user : "";
      const lastSeen = typeof record.last_seen === "string" ? record.last_seen : "";
      if (!userId || !lastSeen) continue;
      const lastSeenMs = Date.parse(lastSeen);
      if (!Number.isFinite(lastSeenMs)) continue;
      if (lastSeenMs >= nowMs - 45_000) {
        nextActivity[userId] = {
          active: true,
          lastLoginAt: nextActivity[userId]?.lastLoginAt ?? null,
        };
      }
    }
    for (const record of logRecords) {
      const userId = typeof record.user === "string" ? record.user : "";
      const occurredAt = typeof record.occurred_at === "string" ? record.occurred_at : "";
      if (!userId || !occurredAt) continue;
      if (!nextActivity[userId]) {
        nextActivity[userId] = { active: false, lastLoginAt: occurredAt };
        continue;
      }
      if (!nextActivity[userId].lastLoginAt) {
        nextActivity[userId] = {
          ...nextActivity[userId],
          lastLoginAt: occurredAt,
        };
      }
    }
    setRegisteredUserActivity(nextActivity);
    setAdminNotice(activityWarning);
  }

  async function handleDeleteRegisteredUser(userId: string) {
    if (!pb || userId === user?.id || !canDeleteLocalUsers) return;
    const target = registeredUsers.find((entry) => entry.id === userId);
    const label = String(target?.name || target?.email || "this user");
    if (!window.confirm(`Delete ${label}? This removes their KanQual account.`)) {
      return;
    }

    setAdminBusy(true);
    try {
      await deleteUserAccount(pb, userId);
      await refreshRegisteredUsers();
      setAdminNotice("Registered user deleted.");
    } catch (error) {
      setAdminNotice(error instanceof Error ? error.message : "Could not delete registered user.");
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleClearAppData() {
    if (!pb || !canClearLocalAppData) return;
    const shouldClear = window.confirm(
      "Clear all local app data? This deletes registered users, projects, documents, and other stored records on this device.",
    );
    if (!shouldClear) return;

    setAdminBusy(true);
    try {
      await clearAppDataRecords(pb);
      clearRecentProjects();
      clearLocalAccounts();
      clearRemoteSessions();
      localStorage.removeItem("pb_auth");
      sessionStorage.clear();
      logout();
      setAdminNotice("App data cleared. Reloading...");
      window.setTimeout(() => window.location.reload(), 300);
    } catch (error) {
      setAdminNotice(error instanceof Error ? error.message : "Could not clear app data.");
      setAdminBusy(false);
    }
  }

  function handleOpenAdminView(targetView: "projects" | "users") {
    setActiveSettingsModal(null);
    setView(targetView);
  }

  async function handleEmbeddingModelDownload() {
    if (!canDownloadEmbeddingModel) return;
    setEmbeddingModelError("");
    setEmbeddingModelNotice("");
    try {
      await startEmbeddingModelDownload();
      setActiveSettingsModal(null);
      setNotice("Embedding model download started in the background.");
    } catch (error) {
      console.error("Embedding model download failed:", error);
      setEmbeddingModelError(error instanceof Error ? error.message : "Embedding model download failed. Please try again.");
    }
  }

  async function handleEmbeddingModelCancel() {
    if (!canDownloadEmbeddingModel) return;
    setEmbeddingModelError("");
    setEmbeddingModelNotice("");
    try {
      const status = await cancelEmbeddingModelDownload();
      if (status.phase === "cancelling") {
        setEmbeddingModelNotice("Embedding model download is cancelling in the background.");
      }
    } catch (error) {
      console.error("Embedding model cancel failed:", error);
      setEmbeddingModelError(error instanceof Error ? error.message : "Could not cancel the embedding model download.");
    }
  }

  async function handleEmbeddingModelClear() {
    if (!canDeleteEmbeddingModel) return;
    setEmbeddingModelError("");
    setEmbeddingModelNotice("");
    try {
      const status = await invoke<EmbeddingModelStatus>("clear_multilingual_e5_model", {
        authToken: pb?.authStore.token ?? "",
      });
      setEmbeddingModelStatus(status);
      void refreshEmbeddingModelStatus();
      refreshEmbeddingModelPreflight();
      setEmbeddingModelNotice("Local multilingual-e5 files cleared.");
    } catch (error) {
      console.error("Embedding model clear failed:", error);
      setEmbeddingModelError(error instanceof Error ? error.message : "Could not clear local multilingual-e5 files.");
    }
  }

  async function handleOllamaTestConnection() {
    if (!canManageLlmSettings) return;
    setOllamaBusy(true);
    setOllamaError("");
    setOllamaNotice("");
    try {
      const result = await invoke<OllamaDiscoveryResult>("discover_ollama_models", {
        request: {
          protocol: settings.llm.ollamaProtocol,
          host: settings.llm.ollamaHost,
          port: settings.llm.ollamaPort,
          timeoutSeconds: settings.llm.ollamaRequestTimeoutSeconds,
        },
      });
      setOllamaDiscovery(result);
      setOllamaModels(result.models);
      setOllamaNotice(result.message);

      if (result.models.length > 0) {
        const hasSelectedModel = result.models.some((model) => model.name === settings.llm.ollamaSelectedModel);
        if (!hasSelectedModel) {
          persist({
            ...settings,
            llm: {
              ...settings.llm,
              ollamaSelectedModel: result.models[0].name,
            },
          }, "Local LLM settings saved.");
        }
      } else if (settings.llm.ollamaSelectedModel) {
        persist({
          ...settings,
          llm: {
            ...settings.llm,
            ollamaSelectedModel: "",
          },
        }, "Local LLM settings saved.");
      }
    } catch (error) {
      console.error("Local LLM connection test failed:", error);
      setOllamaDiscovery(null);
      setOllamaModels([]);
      setOllamaError(error instanceof Error ? error.message : "Could not connect to the local LLM server.");
    } finally {
      setOllamaBusy(false);
    }
  }

  const activeSettingsCard = settingsOverviewCards.find((card) => card.id === activeSettingsModal) ?? null;

  if (!canOpenAppSettings) {
    return (
      <div className="view">
        <header className="view-header">
          <div className="users-header-title-wrap">
            <h1>App Settings</h1>
          </div>
        </header>
        <div className="empty-state">
          <p>You do not have permission to open App Settings on this device.</p>
        </div>
      </div>
    );
  }

  function renderSettingsModalBody(sectionId: string) {
    switch (sectionId) {
      case "permissions":
        return (
          <SettingsModalSection
            title={t("appSettings.permissions.roleMatrixTitle")}
            description={t("appSettings.permissions.roleMatrixDescription")}
          >
            <div className="permission-matrix">
              <p className="permission-matrix-intro">
                {t("appSettings.permissions.roleMatrixIntro")}
              </p>
              {Object.entries(permissionMatrixByCategory).map(([category, rows]) => (
                <section key={category} className="permission-matrix-section">
                  <h3>{category}</h3>
                  <div className="permission-matrix-table-wrap">
                    <table className="permission-matrix-table">
                      <thead>
                        <tr>
                          <th>{t("appSettings.permissions.columnPermission")}</th>
                          <th>{t("appSettings.permissions.columnDescription")}</th>
                          <th>{t("appSettings.permissions.columnAdministrator")}</th>
                          <th>{t("appSettings.permissions.columnOwner")}</th>
                          <th>{t("appSettings.permissions.columnEditor")}</th>
                          <th>{t("appSettings.permissions.columnCoder")}</th>
                          <th>{t("appSettings.permissions.columnViewer")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={`${row.category}-${row.permission}`}>
                            <td>{row.permission}</td>
                            <td>{row.description}</td>
                            <td className={row.administrator ? "permission-matrix-cell permission-matrix-cell--yes" : "permission-matrix-cell permission-matrix-cell--no"}>{row.administrator ? t("appSettings.permissions.yes") : t("appSettings.permissions.no")}</td>
                            <td className={row.owner ? "permission-matrix-cell permission-matrix-cell--yes" : "permission-matrix-cell permission-matrix-cell--no"}>{row.owner ? t("appSettings.permissions.yes") : t("appSettings.permissions.no")}</td>
                            <td className={row.editor ? "permission-matrix-cell permission-matrix-cell--yes" : "permission-matrix-cell permission-matrix-cell--no"}>{row.editor ? t("appSettings.permissions.yes") : t("appSettings.permissions.no")}</td>
                            <td className={row.coder ? "permission-matrix-cell permission-matrix-cell--yes" : "permission-matrix-cell permission-matrix-cell--no"}>{row.coder ? t("appSettings.permissions.yes") : t("appSettings.permissions.no")}</td>
                            <td className={row.viewer ? "permission-matrix-cell permission-matrix-cell--yes" : "permission-matrix-cell permission-matrix-cell--no"}>{row.viewer ? t("appSettings.permissions.yes") : t("appSettings.permissions.no")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>
          </SettingsModalSection>
        );
      case "network":
        return (
          <>
            <SettingsModalSection
              title={t("appSettings.network.accessModeTitle")}
              description="Choose whether this Kanqual database stays available only on this device or can be reached from other trusted devices on the network."
            >
              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">{t("appSettings.network.networkMode")}</div>
                  <div className="settings-row-desc">
                    {networkMode === "local"
                      ? t("appSettings.network.localOnlyDescription")
                      : localIp
                        ? t("appSettings.network.activeWithAddress", {
                            address: `http://${localIp}:8090`,
                          })
                        : t("appSettings.network.activeWithoutAddress")}
                  </div>
                </div>
                <div className="segmented-control">
                  {(["local", "lan"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={networkMode === option ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                      onClick={() => void handleNetworkModeToggle(option)}
                      disabled={networkSwitching}
                    >
                      {networkSwitching && option !== networkMode
                        ? t("appSettings.network.restarting")
                        : option === "local"
                          ? t("appSettings.network.localOnlyOption")
                          : t("appSettings.network.allowNetworkOption")}
                    </button>
                  ))}
                </div>
              </div>
            </SettingsModalSection>
            {networkMode === "lan" && (
              <SettingsModalSection
                title={t("appSettings.network.connectionAddressesTitle")}
                description={t("appSettings.network.connectionAddressesDescription")}
              >
                <CollaborationAddressCard
                  label={t("appSettings.network.localNetwork")}
                  description={t("appSettings.network.localNetworkDescription")}
                  host={localIpError ? null : localIp}
                  port={8090}
                  loading={!localIp && !localIpError}
                  ping={localPing}
                  disabled={networkMode !== "lan"}
                  onTest={testLocalPing}
                  scope="local"
                />

                <CollaborationAddressCard
                  label={t("appSettings.network.externalInternet")}
                  description={t("appSettings.network.externalInternetDescription")}
                  host={externalIp}
                  port={8090}
                  loading={externalIpLoading}
                  ping={externalPing}
                  disabled={networkMode !== "lan"}
                  onTest={testExternalPing}
                  scope="internet"
                />
              </SettingsModalSection>
            )}
          </>
        );
      case "storage":
        return (
          <SettingsModalSection
            title={t("appSettings.storage.localStorageTitle")}
            description="Review where Kanqual stores its managed data and how much space the tracked folders currently use."
          >
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">{t("appSettings.storage.storageMode")}</div>
                <div className="settings-row-desc">
                  {appInfo?.portableMode === true
                    ? t("appSettings.storage.portable")
                    : appInfo?.portableMode === false
                      ? t("appSettings.storage.installed")
                      : t("common.loading")}
                </div>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">{t("appSettings.storage.appDataFolder")}</div>
                <div className="settings-row-desc settings-code-line">{appInfo?.appDataDir ?? t("common.loading")}</div>
              </div>
              {appInfo?.appDataDir && (
                <button
                  className="btn"
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(appInfo.appDataDir)}
                >
                  {t("appSettings.storage.copyPath")}
                </button>
              )}
            </div>

            <div className="app-settings-stats">
              <div className="app-settings-stat-card">
                <strong>{t("appSettings.storage.database")}</strong>
                <span>{formatBytes(storageSummary.databaseBytes)}</span>
                <small>{formatStorageFileSummary(storageSummary.databaseFiles, "pb_data", t)}</small>
              </div>
              <div className="app-settings-stat-card">
                <strong>{t("appSettings.storage.backups")}</strong>
                <span>{formatBytes(storageSummary.backupBytes)}</span>
                <small>{formatStorageFileSummary(storageSummary.backupFiles, "project_backups", t)}</small>
              </div>
              <div className="app-settings-stat-card">
                <strong>{t("appSettings.storage.totalTrackedStorage")}</strong>
                <span>{formatBytes(storageSummary.databaseBytes + storageSummary.backupBytes)}</span>
                <small>{t("appSettings.storage.totalTrackedStorageDescription")}</small>
              </div>
            </div>
          </SettingsModalSection>
        );
      case "startup":
        if (!canChangeStartupSettings) {
          return <div className="settings-empty-state">You do not have permission to change startup or session settings.</div>;
        }
        return (
          <SettingsModalSection
            title={t("appSettings.startup.title")}
            description="Choose what Kanqual should reopen automatically when someone starts the app on this device."
          >
            <label className="settings-toggle-row">
              <span>
                <strong>Sign in last user on launch</strong>
              </span>
              <input
                type="checkbox"
                checked={settings.startup.autoLoginLastUser}
                onChange={(e) => persist({
                  ...settings,
                  startup: { ...settings.startup, autoLoginLastUser: e.target.checked },
                }, "Startup behavior saved.")}
              />
            </label>

            <label className="settings-toggle-row">
              <span>
                <strong>Reopen last project on launch</strong>
              </span>
              <input
                type="checkbox"
                checked={settings.startup.reopenLastProject}
                onChange={(e) => persist({
                  ...settings,
                  startup: { ...settings.startup, reopenLastProject: e.target.checked },
                }, "Startup behavior saved.")}
              />
            </label>
          </SettingsModalSection>
        );
      case "language":
        return (
          <SettingsModalSection
            title={t("appSettings.language.title")}
            description={t("appSettings.language.description")}
          >
            <div className="settings-row">
              <select
                className="form-input"
                value={locale}
                onChange={(e) => {
                  setLocale(e.target.value as (typeof SUPPORTED_LOCALES)[number]);
                  setNotice(t("appSettings.language.saved"));
                }}
              >
                {SUPPORTED_LOCALES.map((option) => (
                  <option key={option} value={option}>
                    {LOCALE_LABELS[option]}
                  </option>
                ))}
              </select>
            </div>
          </SettingsModalSection>
        );
      case "import":
        return (
          <>
            <SettingsModalSection
              title={t("appSettings.documentImport.title")}
              description={t("appSettings.documentImport.titleDescription")}
            >
              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">{t("appSettings.documentImport.defaultModeLabel")}</div>
                  <div className="settings-row-desc">{t("appSettings.documentImport.defaultModeDescription")}</div>
                </div>
                <div className="segmented-control">
                  {(["upload", "paste"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={settings.documentImport.defaultMode === option ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                      onClick={() => persist({
                        ...settings,
                        documentImport: { ...settings.documentImport, defaultMode: option },
                      }, t("appSettings.documentImport.saved"))}
                    >
                      {option === "upload"
                        ? t("appSettings.documentImport.upload")
                        : t("appSettings.documentImport.paste")}
                    </button>
                  ))}
                </div>
              </div>
            </SettingsModalSection>

            <SettingsModalSection
              title={t("appSettings.documentImport.safeguardsTitle")}
              description={t("appSettings.documentImport.safeguardsDescription")}
            >
              <label className="settings-toggle-row">
                <span>
                  <strong>{t("appSettings.documentImport.autoNameLabel")}</strong>
                </span>
                <input
                  type="checkbox"
                  checked={settings.documentImport.autoNameFromFile}
                  onChange={(e) => persist({
                    ...settings,
                    documentImport: { ...settings.documentImport, autoNameFromFile: e.target.checked },
                  }, t("appSettings.documentImport.saved"))}
                />
              </label>

              <label className="settings-toggle-row">
                <span>
                  <strong>{t("appSettings.documentImport.trimImportedTextLabel")}</strong>
                </span>
                <input
                  type="checkbox"
                  checked={settings.documentImport.trimImportedText}
                  onChange={(e) => persist({
                    ...settings,
                    documentImport: { ...settings.documentImport, trimImportedText: e.target.checked },
                  }, t("appSettings.documentImport.saved"))}
                />
              </label>

              <label className="settings-toggle-row">
                <span>
                  <strong>{t("appSettings.documentImport.warnBeforeEmptyImportLabel")}</strong>
                </span>
                <input
                  type="checkbox"
                  checked={settings.documentImport.warnBeforeEmptyImport}
                  onChange={(e) => persist({
                    ...settings,
                    documentImport: { ...settings.documentImport, warnBeforeEmptyImport: e.target.checked },
                  }, t("appSettings.documentImport.saved"))}
                />
              </label>
            </SettingsModalSection>
          </>
        );
      case "privacy":
        return (
          <SettingsModalSection
            title={t("appSettings.privacy.localControlsTitle")}
            description="Choose how much local activity and device-level identity information Kanqual should retain on this machine."
          >
            <label className="settings-toggle-row">
              <span>
                <strong>{t("appSettings.privacy.maskFilePathsLabel")}</strong>
              </span>
              <input
                type="checkbox"
                checked={settings.privacy.maskFilePaths}
                onChange={(e) => persist({
                  ...settings,
                  privacy: { ...settings.privacy, maskFilePaths: e.target.checked },
                }, "Privacy settings saved.")}
              />
            </label>

            <label className="settings-toggle-row">
              <span>
                <strong>{t("appSettings.privacy.clearRecentProjectsOnSignOutLabel")}</strong>
              </span>
              <input
                type="checkbox"
                checked={settings.privacy.clearRecentProjectsOnSignOut}
                onChange={(e) => persist({
                  ...settings,
                  privacy: { ...settings.privacy, clearRecentProjectsOnSignOut: e.target.checked },
                }, "Privacy settings saved.")}
              />
            </label>

            <label className="settings-toggle-row">
              <span>
                <strong>{t("appSettings.privacy.forgetLoginIdentitiesOnLogoutLabel")}</strong>
              </span>
              <input
                type="checkbox"
                checked={settings.privacy.forgetLoginIdentitiesOnLogout}
                onChange={(e) => persist({
                  ...settings,
                  privacy: { ...settings.privacy, forgetLoginIdentitiesOnLogout: e.target.checked },
                }, "Privacy settings saved.")}
              />
            </label>
          </SettingsModalSection>
        );
      case "diagnostics":
        return (
          <>
            <SettingsModalSection
              title={t("appSettings.diagnostics.healthChecksTitle")}
              description="Inspect the local runtime, storage connection, and core service endpoint for this installation."
            >
              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">{t("appSettings.diagnostics.appVersion")}</div>
                  <div className="settings-row-desc">{appInfo?.appVersion ?? "Loading..."}</div>
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">{t("appSettings.diagnostics.localDatabase")}</div>
                  <div className="settings-row-desc">
                    {dbHealth === "checking"
                      ? t("appSettings.diagnostics.databaseChecking")
                      : dbHealth === "ok"
                        ? t("appSettings.diagnostics.databaseHealthy")
                        : t("appSettings.diagnostics.databaseUnavailable")}
                  </div>
                </div>
                <button className="btn" type="button" onClick={() => void refreshDiagnostics()} disabled={storageBusy}>
                  {t("appSettings.diagnostics.recheck")}
                </button>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">{t("appSettings.diagnostics.databaseEndpoint")}</div>
                  <div className="settings-row-desc settings-code-line">http://127.0.0.1:8090</div>
                </div>
              </div>
            </SettingsModalSection>

            <SettingsModalSection
              title="PostgreSQL"
              description="Bootstrap a local PostgreSQL app role and database without changing the current PocketBase runtime yet."
            >
              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">Local PostgreSQL service</div>
                  <div className="settings-row-desc">
                    {postgresStatus
                      ? (postgresStatus.serviceReachable
                        ? `${postgresStatus.host}:${postgresStatus.port} reachable`
                        : `${postgresStatus.host}:${postgresStatus.port} unreachable`)
                      : "Checking..."}
                  </div>
                </div>
                <button className="btn" type="button" onClick={() => void refreshPostgres()} disabled={postgresBusy}>
                  Refresh
                </button>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">Bootstrap identity</div>
                  <div className="settings-row-desc settings-code-line">
                    {postgresStatus?.bootstrapIdentityPath ?? "Loading..."}
                  </div>
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">Planned app role</div>
                  <div className="settings-row-desc settings-code-line">
                    {postgresStatus
                      ? `${postgresStatus.appRoleName} -> ${postgresStatus.appDatabase}`
                      : "Loading..."}
                  </div>
                </div>
              </div>

              <label className="form-label">
                Current PostgreSQL superuser password
                <input
                  className="form-input"
                  type="password"
                  value={postgresSuperuserPassword}
                  onChange={(e) => setPostgresSuperuserPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="Enter the current postgres password"
                />
              </label>

              <div className="settings-warning">
                This bootstrap step uses the current PostgreSQL superuser credential once to create or rotate the restricted Kanqual app role and ensure the local `kanqual` database exists.
              </div>

              {postgresError ? <p className="auth-error">{postgresError}</p> : null}
              {postgresNotice ? <div className="settings-success project-settings-success">{postgresNotice}</div> : null}

              {postgresBootstrapResult ? (
                <div className="settings-row">
                  <div className="settings-row-info">
                    <div className="settings-row-label">Last bootstrap result</div>
                    <div className="settings-row-desc settings-code-line">
                      {postgresBootstrapResult.appRoleName}
                      {" | "}
                      {postgresBootstrapResult.appDatabase}
                      {" | "}
                      {postgresBootstrapResult.appRoleReady ? "verified" : "needs review"}
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">Schema</div>
                  <div className="settings-row-desc">
                    {postgresSchemaResult
                      ? `Ready (${postgresSchemaResult.appliedVersions.join(", ") || "no recorded versions"})`
                      : "Not applied yet"}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void handleEnsurePostgresSchema()}
                  disabled={postgresBusy || !postgresStatus?.bootstrapApplied}
                >
                  Apply schema
                </button>
              </div>

              <label className="form-label">
                Project name
                <input
                  className="form-input"
                  type="text"
                  value={postgresProjectName}
                  onChange={(e) => setPostgresProjectName(e.target.value)}
                  placeholder="Postgres spike project"
                />
              </label>

              <label className="form-label">
                Project description
                <textarea
                  className="form-input"
                  value={postgresProjectDescription}
                  onChange={(e) => setPostgresProjectDescription(e.target.value)}
                  rows={3}
                  placeholder="Optional description for the Postgres-backed project."
                />
              </label>

              <div className="form-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => void refreshPostgresProjects()}
                  disabled={postgresBusy || !postgresSchemaResult?.ready}
                >
                  Refresh projects
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => void handleCreatePostgresProject()}
                  disabled={postgresBusy || !postgresSchemaResult?.ready || !postgresProjectName.trim()}
                >
                  Create Postgres project
                </button>
              </div>

              <div className="users-table-wrap app-settings-admin-users-table-wrap">
                <table className="users-table app-settings-admin-users-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Description</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {!postgresProjects.length ? (
                      <tr>
                        <td colSpan={3} className="users-td users-td--muted">No PostgreSQL projects yet.</td>
                      </tr>
                    ) : (
                      postgresProjects.map((project) => (
                        <tr key={project.id}>
                          <td>{project.name}</td>
                          <td>{project.description || "—"}</td>
                          <td>{project.createdAt}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => void handleBootstrapPostgres()}
                  disabled={postgresBusy || !postgresSuperuserPassword.trim()}
                >
                  {postgresBusy ? "Bootstrapping..." : "Bootstrap PostgreSQL"}
                </button>
              </div>
            </SettingsModalSection>
          </>
        );
      case "administration":
        if (!canAccessAdministration) {
          return <div className="settings-empty-state">{t("appSettings.admin.emptyState")}</div>;
        }
        return (
          <>
            <SettingsModalSection
              title={t("appSettings.admin.shortcutsTitle")}
              description={t("appSettings.admin.shortcutsDescription")}
            >
              <div className="app-settings-stats">
                <button
                  type="button"
                  className="app-settings-stat-card app-settings-stat-card--button"
                  onClick={() => handleOpenAdminView("projects")}
                >
                  <strong>{t("appSettings.admin.projectAdministration")}</strong>
                  <span>{t("appSettings.admin.openProjects")}</span>
                  <small>{t("appSettings.admin.projectAdministrationDescription")}</small>
                </button>
                <button
                  type="button"
                  className="app-settings-stat-card app-settings-stat-card--button"
                  onClick={() => handleOpenAdminView("users")}
                  disabled={!activeProject}
                >
                  <strong>{t("appSettings.admin.userAdministration")}</strong>
                  <span>{activeProject ? t("appSettings.admin.openProjectUsers") : t("appSettings.admin.openProjectFirst")}</span>
                  <small>{t("appSettings.admin.userAdministrationDescription")}</small>
                </button>
              </div>
            </SettingsModalSection>

            <SettingsModalSection
              title={t("appSettings.admin.registeredUsersTitle")}
              description={t("appSettings.admin.registeredUsersDescription")}
            >
              <div className="users-table-wrap app-settings-admin-users-table-wrap">
                <table className="users-table app-settings-admin-users-table">
                  <thead>
                    <tr>
                      <th className="users-th" style={{ width: "42%" }}>{t("appSettings.admin.userTable.username")}</th>
                      <th className="users-th" style={{ width: "18%" }}>{t("appSettings.admin.userTable.status")}</th>
                      <th className="users-th" style={{ width: "24%" }}>{t("appSettings.admin.userTable.lastLogin")}</th>
                      <th className="users-th" style={{ width: "16%" }}>{t("appSettings.admin.userTable.action")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminBusy && (
                      <tr>
                        <td colSpan={4} className="users-td-msg">{t("appSettings.admin.userTable.loadingUsers")}</td>
                      </tr>
                    )}
                    {!adminBusy && !registeredUserTableRows.length && canViewLocalUsers && (
                      <tr>
                        <td colSpan={4} className="users-td-msg">{t("appSettings.admin.userTable.noRegisteredUsers")}</td>
                      </tr>
                    )}
                    {!canViewLocalUsers && (
                      <tr>
                        <td colSpan={4} className="users-td-msg">You do not have permission to view local users.</td>
                      </tr>
                    )}
                    {!adminBusy && canViewLocalUsers && registeredUserTableRows.map((entry) => (
                      <tr key={entry.id} className="users-row">
                        <td className="users-td users-td--name">
                          <div className="app-settings-admin-user-cell">
                            <strong>{entry.name}</strong>
                            <span className="users-td--muted">{entry.email}</span>
                          </div>
                        </td>
                        <td className="users-td">
                          <span className={`users-activity-status ${entry.active ? "users-activity-status--active" : "users-activity-status--inactive"}`}>
                            {entry.active ? t("projectUsers.tabs.active") : t("projectUsers.tabs.inactive")}
                          </span>
                        </td>
                        <td className="users-td users-td--muted">
                          {formatAdminDateTime(entry.lastLoginAt, t("projectUsers.lastLoginNever"), formatDateTime)}
                        </td>
                        <td className="users-td">
                          <button
                            type="button"
                            className="btn btn--danger"
                            onClick={() => void handleDeleteRegisteredUser(entry.id)}
                            disabled={adminBusy || entry.isCurrentUser || !canDeleteLocalUsers}
                          >
                            {entry.isCurrentUser
                              ? t("appSettings.admin.userTable.currentAccount")
                              : !canDeleteLocalUsers
                                ? t("appSettings.admin.userTable.noPermissionAction")
                                : t("appSettings.admin.userTable.deleteAction")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SettingsModalSection>

            <SettingsModalSection
              title={t("appSettings.admin.destructiveMaintenanceTitle")}
              tone="danger"
              description={t("appSettings.admin.clearAppDataDescription")}
            >
              <div className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-row-label">{t("appSettings.admin.clearAppDataTitle")}</div>
                  <div className="settings-row-desc">
                    {t("appSettings.admin.clearAppDataDescription")}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={() => void handleClearAppData()}
                  disabled={adminBusy || !canClearLocalAppData}
                >
                  {t("appSettings.admin.clearAppDataAction")}
                </button>
              </div>

              {adminNotice && <div className="settings-notice">{adminNotice}</div>}
            </SettingsModalSection>
          </>
        );
      case "updates":
        return (
          <SettingsModalSection
            title={t("appSettings.updates.title")}
            description="Control whether Kanqual checks for newer releases automatically and where to review them manually."
          >
            <label className="settings-toggle-row">
              <span>
                <strong>{t("appSettings.updates.autoCheckLabel")}</strong>
              </span>
              <input
                type="checkbox"
                checked={settings.updates.autoCheck}
                onChange={(e) => persist({
                  ...settings,
                  updates: { ...settings.updates, autoCheck: e.target.checked },
                }, "Update preferences saved.")}
              />
            </label>

            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">{t("appSettings.updates.latestReleasesLabel")}</div>
                <div className="settings-row-desc">{t("appSettings.updates.latestReleasesDescription")}</div>
              </div>
              <button
                className="btn"
                type="button"
                onClick={() => void openUrl(GITHUB_RELEASES_URL)}
              >
                {t("appSettings.updates.openReleasesPage")}
              </button>
            </div>
          </SettingsModalSection>
        );
      case "llm":
        if (!(canManageLlmSettings || canDownloadEmbeddingModel || canDeleteEmbeddingModel)) {
          return <div className="settings-empty-state">You do not have permission to manage local AI Assist settings on this device.</div>;
        }
        return (
          <div className="app-settings-modal-sections">
            <SettingsModalSection
              title={t("appSettings.aiAssist.statusTitle")}
              description="Check whether embeddings, the local server, and the selected model are ready before you start an AI Assist workflow."
            >
              <div className="ai-assist-settings-status-grid">
                <div className="ai-assist-settings-status-card">
                  <span className="ai-assist-settings-status-label">Embeddings</span>
                  <strong>{embeddingModelStatus?.installed ? "Ready" : "Needs download"}</strong>
                  <span className="project-model-description">
                    {formatCompletionStatus(embeddingModelDownloadStatus, embeddingModelStatus)}
                    {embeddingModelStatus?.bytes ? ` | ${formatBytes(embeddingModelStatus.bytes)}` : ""}
                  </span>
                </div>
                <div className="ai-assist-settings-status-card">
                  <span className="ai-assist-settings-status-label">Local LLM</span>
                  <strong>{settings.llm.ollamaEnabled ? "Enabled" : "Disabled"}</strong>
                  <span className="project-model-description">
                    {ollamaDiscovery?.ok
                      ? `Connected | ${ollamaDiscovery.modelCount} models found`
                      : "Not connected yet"}
                  </span>
                </div>
                <div className="ai-assist-settings-status-card">
                  <span className="ai-assist-settings-status-label">Selected model</span>
                  <strong>{settings.llm.ollamaSelectedModel || "None selected"}</strong>
                  <span className="project-model-description">
                    {ollamaDiscovery?.version ? `Server version ${ollamaDiscovery.version}` : "Choose a model after testing the server"}
                  </span>
                </div>
              </div>
            </SettingsModalSection>

            <SettingsModalSection
              title={t("appSettings.aiAssist.labels.embeddingRuntimeStep")}
              description="Download the local embedding model Kanqual uses for search and retrieval, then open tuning only when you need to adjust indexing behavior."
            >
              {embeddingModelError && <div className="form-error project-settings-error">{embeddingModelError}</div>}
              {embeddingModelNotice && <div className="settings-success project-settings-success">{embeddingModelNotice}</div>}

              <div className="project-model-card">
                <div>
                  <div className="project-model-name">{embeddingModelStatus?.displayName ?? "multilingual-e5-large"}</div>
                  <p className="project-model-description">
                    Status: {embeddingModelStatus?.installed ? "Downloaded locally" : "Not downloaded yet"}
                    {embeddingModelStatus?.bytes ? ` | ${formatBytes(embeddingModelStatus.bytes)}` : ""}
                    {embeddingModelStatus?.files ? ` | ${embeddingModelStatus.files} files` : ""}
                  </p>
                  <p className="project-model-description">
                    Completion: {formatCompletionStatus(embeddingModelDownloadStatus, embeddingModelStatus)}
                  </p>
                </div>
              </div>

              <div className="project-export-actions project-export-actions--modal">
                <button
                  className="btn btn--primary"
                  type="button"
                  onClick={() => void handleEmbeddingModelDownload()}
                  disabled={embeddingModelBusy || !!embeddingModelStatus?.installed || !canDownloadEmbeddingModel}
                >
                  {embeddingModelBusy
                    ? embeddingModelDownloadStatus?.phase === "cancelling"
                      ? "Cancelling..."
                      : "Downloading..."
                    : embeddingModelStatus?.installed
                      ? "Already Downloaded"
                      : "Download from Hugging Face"}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => void handleEmbeddingModelCancel()}
                  disabled={
                    !canDownloadEmbeddingModel ||
                    !embeddingModelDownloadStatus ||
                    (embeddingModelDownloadStatus.phase !== "downloading" &&
                      embeddingModelDownloadStatus.phase !== "cancelling")
                  }
                >
                  {embeddingModelDownloadStatus?.phase === "cancelling" ? "Cancelling..." : "Cancel Download"}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => void handleEmbeddingModelClear()}
                  disabled={
                    !canDeleteEmbeddingModel ||
                    embeddingModelBusy ||
                    (!embeddingModelStatus?.installed && !(embeddingModelStatus?.files && embeddingModelStatus.files > 0))
                  }
                >
                  Clear Local Model
                </button>
              </div>

              <details className="ai-assist-settings-disclosure">
                <summary className="ai-assist-settings-disclosure-summary">Show download details</summary>
                <div className="ai-assist-settings-disclosure-body">
                  <ul className="ai-assist-settings-summary-list">
                    <li>
                      <strong>Repository:</strong> <code>{embeddingModelStatus?.repoId ?? "intfloat/multilingual-e5-large"}</code>
                    </li>
                    <li>
                      <strong>Total download:</strong> {formatBytes(embeddingModelPreflight?.totalBytes ?? 0)}
                    </li>
                    <li>
                      <strong>Already on device:</strong> {formatBytes(embeddingModelPreflight?.existingBytes ?? embeddingModelStatus?.bytes ?? 0)}
                      {embeddingModelPreflight?.manifestAvailable ? ` | ${embeddingModelPreflight?.existingFiles ?? 0} files` : ""}
                    </li>
                    <li>
                      <strong>Remaining:</strong> {formatBytes(embeddingModelPreflight?.remainingBytes ?? 0)}
                      {embeddingModelPreflight?.manifestAvailable && embeddingModelPreflight?.remainingFiles != null
                        ? ` across ${embeddingModelPreflight.remainingFiles} files`
                        : ""}
                    </li>
                    <li>
                      <strong>Downloaded:</strong> {embeddingModelStatus?.installed ? formatDownloadDate(embeddingModelStatus.downloadedAtMs) : "Not downloaded yet"}
                    </li>
                    <li>
                      <strong>Location:</strong> <code>{embeddingModelStatus?.modelDir ?? "Detecting local model directory..."}</code>
                    </li>
                    {embeddingModelPreflight?.message ? (
                      <li>
                        <strong>Note:</strong> {embeddingModelPreflight.message}
                      </li>
                    ) : null}
                  </ul>
                </div>
              </details>

              <details className="ai-assist-settings-disclosure">
                <summary className="ai-assist-settings-disclosure-summary">Embedding tuning</summary>
                <div className="ai-assist-settings-disclosure-body">
                  <div className="llm-settings-grid">
                    <label className="form-label">
                      Chunk size
                      <span className="settings-field-hint">
                        Character cap for each embedding chunk. Kanqual also stops earlier when a chunk is likely to exceed the model's token budget.
                      </span>
                      <input
                        className="form-input"
                        type="number"
                        min={100}
                        max={20000}
                        value={settings.llm.chunkSize}
                        onChange={(e) => {
                          const chunkSize = clampInteger(Number(e.target.value), 100, 20000);
                          const overlapSize = Math.min(settings.llm.overlapSize, Math.max(0, chunkSize - 1));
                          persist({
                            ...settings,
                            llm: {
                              ...settings.llm,
                              chunkSize,
                              overlapSize,
                            },
                          }, "LLM settings saved.");
                        }}
                      />
                    </label>

                    <label className="form-label">
                      Overlap size
                      <span className="settings-field-hint">
                        Shared characters between neighboring chunks after token-aware chunking.
                      </span>
                      <input
                        className="form-input"
                        type="number"
                        min={0}
                        max={Math.max(0, settings.llm.chunkSize - 1)}
                        value={settings.llm.overlapSize}
                        onChange={(e) => persist({
                          ...settings,
                          llm: {
                            ...settings.llm,
                            overlapSize: clampInteger(Number(e.target.value), 0, Math.max(0, settings.llm.chunkSize - 1)),
                          },
                        }, "LLM settings saved.")}
                      />
                    </label>

                    <label className="form-label">
                      Batch size
                      <span className="settings-field-hint">
                        Chunks processed together during indexing.
                      </span>
                      <input
                        className="form-input"
                        type="number"
                        min={1}
                        max={256}
                        value={settings.llm.batchSize}
                        onChange={(e) => persist({
                          ...settings,
                          llm: {
                            ...settings.llm,
                            batchSize: clampInteger(Number(e.target.value), 1, 256),
                          },
                        }, "LLM settings saved.")}
                      />
                    </label>
                  </div>
                </div>
              </details>
            </SettingsModalSection>

            <SettingsModalSection
              title={t("appSettings.aiAssist.labels.localLlmConnectionStep")}
              description="Turn on the local server integration, test it, and open the connection settings only when you need to change the endpoint."
            >
              <label className="settings-toggle-row">
                <span>
                  <strong>Enable local LLM integration</strong>
                </span>
                <input
                  type="checkbox"
                  checked={settings.llm.ollamaEnabled}
                  disabled={!canManageLlmSettings}
                  onChange={(e) => persist({
                    ...settings,
                    llm: { ...settings.llm, ollamaEnabled: e.target.checked },
                  }, "LLM settings saved.")}
                />
              </label>

              <div className="project-model-card">
                <div>
                  <div className="project-model-name">Local LLM server</div>
                  <p className="project-model-description">
                    Endpoint: <code>{settings.llm.ollamaProtocol}://{settings.llm.ollamaHost}:{settings.llm.ollamaPort}</code>
                  </p>
                  <p className="project-model-description">
                    Status: {ollamaDiscovery?.ok ? "Connected" : "Not tested yet"}
                    {ollamaDiscovery?.version ? ` | Version ${ollamaDiscovery.version}` : ""}
                    {ollamaDiscovery?.ok ? ` | ${ollamaDiscovery.modelCount} models found` : ""}
                  </p>
                </div>
              </div>

              <div className="project-export-actions project-export-actions--modal llm-connection-actions llm-connection-actions--stacked">
                <button
                  className="btn btn--primary"
                  type="button"
                  onClick={() => void handleOllamaTestConnection()}
                  disabled={ollamaBusy || !canManageLlmSettings}
                >
                  {ollamaBusy ? "Testing..." : "Test Connection"}
                </button>
              </div>

              {ollamaError && <div className="form-error project-settings-error">{ollamaError}</div>}
              {ollamaNotice && <div className="settings-success project-settings-success">{ollamaNotice}</div>}

              <details className="ai-assist-settings-disclosure">
                <summary className="ai-assist-settings-disclosure-summary">Show connection settings</summary>
                <div className="ai-assist-settings-disclosure-body">
                  <fieldset className="llm-settings-grid" disabled={!canManageLlmSettings} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
                    <label className="form-label">
                      Protocol
                      <span className="settings-field-hint">
                        Most local setups use plain HTTP.
                      </span>
                      <select
                        className="form-input"
                        value={settings.llm.ollamaProtocol}
                        onChange={(e) => persist({
                          ...settings,
                          llm: {
                            ...settings.llm,
                            ollamaProtocol: e.target.value === "https" ? "https" : "http",
                          },
                        }, "LLM settings saved.")}
                      >
                        <option value="http">http</option>
                        <option value="https">https</option>
                      </select>
                    </label>

                    <label className="form-label">
                      Host / URL
                      <span className="settings-field-hint">
                        Usually <code>127.0.0.1</code> or <code>localhost</code>.
                      </span>
                      <input
                        className="form-input"
                        type="text"
                        value={settings.llm.ollamaHost}
                        onChange={(e) => persist({
                          ...settings,
                          llm: {
                            ...settings.llm,
                            ollamaHost: e.target.value,
                          },
                        }, "LLM settings saved.")}
                      />
                    </label>

                    <label className="form-label">
                      Port
                      <span className="settings-field-hint">
                        Default for many local servers: <code>11434</code>.
                      </span>
                      <input
                        className="form-input"
                        type="number"
                        min={1}
                        max={65535}
                        value={settings.llm.ollamaPort}
                        onChange={(e) => persist({
                          ...settings,
                          llm: {
                            ...settings.llm,
                            ollamaPort: clampInteger(Number(e.target.value), 1, 65535),
                          },
                        }, "LLM settings saved.")}
                      />
                    </label>

                    <label className="form-label">
                      Request timeout
                      <span className="settings-field-hint">
                        Seconds to wait when testing or listing models.
                      </span>
                      <input
                        className="form-input"
                        type="number"
                        min={5}
                        max={600}
                        value={settings.llm.ollamaRequestTimeoutSeconds}
                        onChange={(e) => persist({
                          ...settings,
                          llm: {
                            ...settings.llm,
                            ollamaRequestTimeoutSeconds: clampInteger(Number(e.target.value), 5, 600),
                          },
                        }, "LLM settings saved.")}
                      />
                    </label>
                  </fieldset>
                </div>
              </details>
            </SettingsModalSection>

            <SettingsModalSection
              title={t("appSettings.aiAssist.labels.modelDefaultsStep")}
              description="Choose the local model Kanqual should use, then expand advanced defaults only when you want to tune generation behavior."
            >
              <fieldset className="llm-settings-grid llm-settings-grid--single" disabled={!canManageLlmSettings} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
                <label className="form-label">
                  Available local model
                  <span className="settings-field-hint">
                    Test the connection first to load installed models from this server.
                  </span>
                  <select
                    className="form-input"
                    value={settings.llm.ollamaSelectedModel}
                    onChange={(e) => persist({
                      ...settings,
                      llm: {
                        ...settings.llm,
                        ollamaSelectedModel: e.target.value,
                      },
                    }, "LLM settings saved.")}
                    disabled={ollamaModels.length === 0}
                  >
                    <option value="">{ollamaModels.length === 0 ? "No models loaded yet" : "Select a model"}</option>
                    {ollamaModels.map((model) => (
                      <option key={model.name} value={model.name}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                </label>
              </fieldset>

              <details className="ai-assist-settings-disclosure">
                <summary className="ai-assist-settings-disclosure-summary">{t("appSettings.aiAssist.labels.advancedGenerationDefaults")}</summary>
                <div className="ai-assist-settings-disclosure-body">
                  <fieldset className="llm-settings-grid" disabled={!canManageLlmSettings} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
                    <label className="form-label">
                      Temperature
                      <span className="settings-field-hint">
                        Lower values are more deterministic.
                      </span>
                      <input
                        className="form-input"
                        type="number"
                        min={0}
                        max={2}
                        step={0.1}
                        value={settings.llm.ollamaTemperature}
                        onChange={(e) => persist({
                          ...settings,
                          llm: {
                            ...settings.llm,
                            ollamaTemperature: Math.max(0, Math.min(2, Number(e.target.value) || 0)),
                          },
                        }, "LLM settings saved.")}
                      />
                    </label>

                    <label className="form-label">
                      Context window
                      <span className="settings-field-hint">
                        Default <code>num_ctx</code> target for future requests.
                      </span>
                      <input
                        className="form-input"
                        type="number"
                        min={256}
                        max={131072}
                        value={settings.llm.ollamaNumCtx}
                        onChange={(e) => persist({
                          ...settings,
                          llm: {
                            ...settings.llm,
                            ollamaNumCtx: clampInteger(Number(e.target.value), 256, 131072),
                          },
                        }, "LLM settings saved.")}
                      />
                    </label>

                    <label className="form-label">
                      Keep alive (minutes)
                      <span className="settings-field-hint">
                        Keeps models warm between requests.
                      </span>
                      <input
                        className="form-input"
                        type="number"
                        min={0}
                        max={1440}
                        value={settings.llm.ollamaKeepAliveMinutes}
                        onChange={(e) => persist({
                          ...settings,
                          llm: {
                            ...settings.llm,
                            ollamaKeepAliveMinutes: clampInteger(Number(e.target.value), 0, 1440),
                          },
                        }, "LLM settings saved.")}
                      />
                    </label>

                    <label className="form-label">
                      Relevant-segment shortlist
                      <span className="settings-field-hint">
                        Top matches sent to the model before it narrows them down.
                      </span>
                      <input
                        className="form-input"
                        type="number"
                        min={1}
                        max={50}
                        value={settings.llm.ollamaRelevantSegmentsCandidateLimit}
                        onChange={(e) => {
                          const candidateLimit = clampInteger(Number(e.target.value), 1, 50);
                          persist({
                            ...settings,
                            llm: {
                              ...settings.llm,
                              ollamaRelevantSegmentsCandidateLimit: candidateLimit,
                              ollamaRelevantSegmentsMaxResults: Math.min(
                                settings.llm.ollamaRelevantSegmentsMaxResults,
                                candidateLimit,
                              ),
                            },
                          }, "LLM settings saved.");
                        }}
                      />
                    </label>

                    <label className="form-label">
                      Relevant segments returned
                      <span className="settings-field-hint">
                        Maximum number of segments returned to AI Assisted Coding.
                      </span>
                      <input
                        className="form-input"
                        type="number"
                        min={1}
                        max={settings.llm.ollamaRelevantSegmentsCandidateLimit}
                        value={settings.llm.ollamaRelevantSegmentsMaxResults}
                        onChange={(e) => persist({
                          ...settings,
                          llm: {
                            ...settings.llm,
                            ollamaRelevantSegmentsMaxResults: clampInteger(
                              Number(e.target.value),
                              1,
                              settings.llm.ollamaRelevantSegmentsCandidateLimit,
                            ),
                          },
                        }, "LLM settings saved.")}
                      />
                    </label>
                  </fieldset>
                </div>
              </details>
            </SettingsModalSection>
          </div>
        );
      default:
        return null;
    }
  }

  return (
    <div className="view app-settings-view">
      <header className="view-header">
        <div className="users-header-title-wrap">
          <h1>App Settings</h1>
          <button
            type="button"
            className="users-help-icon-btn"
            aria-label="Show App Settings help"
            title="Show Help"
            onClick={() => setHelpOpen(true)}
          >
            <HelpIcon className="users-help-icon" />
          </button>
        </div>
      </header>

      {helpOpen && (
        <div className="modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="modal modal--help" onClick={(event) => event.stopPropagation()}>
            <h2>App Settings Help</h2>
            <p className="users-guide-copy">
                Manage network mode, configure AI runtime details, download, clear, or inspect embedding models, customize appearance, review storage and diagnostics, and perform administrator-only maintenance.
            </p>
            <p className="users-guide-copy">
                Use App Settings for device-wide or host-runtime behavior rather than project-shared behavior. Open the card that matches the area you want to manage.
              </p>
              <p className="users-guide-copy">
                Some actions are host-only and some are administrator-only. Changes here affect the local machine or host environment, not shared project content.
              </p>
            <div className="form-actions">
              <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {notice && <div className="settings-success" style={{ marginBottom: 18 }}>{notice}</div>}

      <div className="app-settings-overview-shell">
        <div className="app-settings-overview-stack">
          {canViewLicensingInfo && (
          <section className="app-settings-about-card">
            <div className="app-settings-about-header">
              <div className="app-settings-about-copy">
                <h2>{t("appSettings.about.title")}</h2>
                <p>{t("appSettings.about.description")}</p>
              </div>
              <button
                type="button"
                className="btn btn--sm app-settings-about-toggle"
                onClick={() => setAboutCardExpanded((expanded) => !expanded)}
                aria-expanded={aboutCardExpanded}
              >
                {aboutCardExpanded
                  ? t("appSettings.about.collapse")
                  : t("appSettings.about.expand")}
              </button>
            </div>
            {aboutCardExpanded && (
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
                <p>
                  {t("appSettings.about.createdByBody")}
                </p>
              </section>

              <hr className="about-kanqual-separator" />

              <section className="about-kanqual-section">
                <h4>{t("appSettings.about.citation")}</h4>
                <p>
                  {t("appSettings.about.citationNote")}
                </p>
                <div className="about-kanqual-citation">
                  {t("appSettings.about.citationExample", {
                    version: appInfo?.appVersion ?? "0.9.1",
                  })}
                </div>
              </section>

              <hr className="about-kanqual-separator" />

              <section className="about-kanqual-section">
                <h4>{t("appSettings.about.license")}</h4>
                <p>
                  {t("appSettings.about.licenseBody")} {t("appSettings.about.licenseNote")}
                </p>
              </section>

              <hr className="about-kanqual-separator" />

              <section className="about-kanqual-section">
                <h4>{t("appSettings.about.dependencyLicenses")}</h4>
                <p className="about-kanqual-license-note">
                  {t("appSettings.about.dependencyLicensesNote")}
                </p>

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
            )}
          </section>
          )}

          <div className="app-settings-overview-sections">
            {appSettingsSections.map((section) => (
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
                      onClick={() => setActiveSettingsModal(card.id)}
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

      {false && (
        <>
      <section className="settings-section settings-section--wide">
        <div className="settings-section-header">
          <div>
            <h2 className="settings-section-title">Network & Collaboration</h2>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">{t("appSettings.network.networkMode")}</div>
            <div className="settings-row-desc">
              {networkMode === "local"
                ? t("appSettings.network.localOnlyDescription")
                : localIp
                  ? t("appSettings.network.activeWithAddress", {
                      address: `http://${localIp}:8090`,
                    })
                  : t("appSettings.network.activeWithoutAddress")}
            </div>
          </div>
          <div className="segmented-control">
            {(["local", "lan"] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={networkMode === option ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                onClick={() => void handleNetworkModeToggle(option)}
                disabled={networkSwitching}
              >
                {networkSwitching && option !== networkMode
                  ? t("appSettings.network.restarting")
                  : option === "local"
                    ? t("appSettings.network.localOnlyOption")
                    : t("appSettings.network.allowNetworkOption")}
              </button>
            ))}
          </div>
        </div>

        {networkMode === "lan" && (
          <>
            <div className="settings-warning settings-warning--danger">
              <strong>LAN mode is live for this session.</strong>
              <br />
              Anyone on the same trusted network who can reach this device can attempt to connect to Kanqual until the app closes or you switch back to local-only mode.
            </div>
            <div className="settings-warning">
              <strong>Session behavior and auditability</strong>
              <br />
              Kanqual always reverts to local-only mode on next launch. When a project is open, LAN/local mode changes are also written to that project's log.
            </div>
            <CollaborationAddressCard
              label={t("appSettings.network.localNetwork")}
              description={t("appSettings.network.localNetworkDescription")}
              host={localIpError ? null : localIp}
              port={8090}
              loading={!localIp && !localIpError}
              ping={localPing}
              disabled={networkMode !== "lan"}
              onTest={testLocalPing}
              scope="local"
            />

            <CollaborationAddressCard
              label={t("appSettings.network.externalInternet")}
              description={t("appSettings.network.externalInternetDescription")}
              host={externalIp}
              port={8090}
              loading={externalIpLoading}
              ping={externalPing}
              disabled={networkMode !== "lan"}
              onTest={testExternalPing}
              scope="internet"
            />
          </>
        )}
        {networkMode !== "lan" && (
          <div className="settings-warning">
            <strong>Local-only mode is recommended for routine work.</strong>
            <br />
            Other devices cannot reach this Kanqual database while local-only mode is active. Kanqual will also start this way again on next launch.
          </div>
        )}
      </section>

      <section className="settings-section settings-section--wide">
        <div className="settings-section-header">
          <div>
            <h2 className="settings-section-title">{t("appSettings.storage.localStorageTitle")}</h2>
          </div>
          {appInfo?.appDataDir && (
            <button
              className="btn"
              type="button"
              onClick={() => void navigator.clipboard.writeText(appInfo?.appDataDir ?? "")}
            >
              Copy Path
            </button>
          )}
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">{t("appSettings.storage.storageMode")}</div>
            <div className="settings-row-desc">
              {appInfo?.portableMode === true
                ? t("appSettings.storage.portable")
                : appInfo?.portableMode === false
                  ? t("appSettings.storage.installed")
                  : t("common.loading")}
            </div>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">{t("appSettings.storage.appDataFolder")}</div>
            <div className="settings-row-desc settings-code-line">{appInfo?.appDataDir ?? t("common.loading")}</div>
          </div>
        </div>

        <div className="app-settings-stats">
          <div className="app-settings-stat-card">
            <strong>{t("appSettings.storage.database")}</strong>
            <span>{formatBytes(storageSummary.databaseBytes)}</span>
            <small>{formatStorageFileSummary(storageSummary.databaseFiles, "pb_data", t)}</small>
          </div>
          <div className="app-settings-stat-card">
            <strong>{t("appSettings.storage.backups")}</strong>
            <span>{formatBytes(storageSummary.backupBytes)}</span>
            <small>{formatStorageFileSummary(storageSummary.backupFiles, "project_backups", t)}</small>
          </div>
          <div className="app-settings-stat-card">
            <strong>{t("appSettings.storage.totalTrackedStorage")}</strong>
            <span>{formatBytes(storageSummary.databaseBytes + storageSummary.backupBytes)}</span>
            <small>{t("appSettings.storage.totalTrackedStorageDescription")}</small>
          </div>
        </div>
      </section>

      <section className="settings-section settings-section--wide">
        <div className="settings-section-header">
          <div>
            <h2 className="settings-section-title">{t("appSettings.sectionTitles.startup")}</h2>
          </div>
        </div>

        <label className="settings-toggle-row">
          <span>
            <strong>Reopen last project on launch</strong>
            <small>If the project still exists, Kanqual will reopen it automatically after sign-in.</small>
          </span>
          <input
            type="checkbox"
            checked={settings.startup.reopenLastProject}
            onChange={(e) => persist({
              ...settings,
              startup: { ...settings.startup, reopenLastProject: e.target.checked },
            }, "Startup behavior saved.")}
          />
        </label>
      </section>

      <section className="settings-section settings-section--wide">
        <div className="settings-section-header">
          <div>
            <h2 className="settings-section-title">{t("appSettings.sectionTitles.documentImport")}</h2>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">{t("appSettings.documentImport.defaultModeLabel")}</div>
            <div className="settings-row-desc">{t("appSettings.documentImport.defaultModeDescription")}</div>
          </div>
          <div className="segmented-control">
            {(["upload", "paste"] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={settings.documentImport.defaultMode === option ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                onClick={() => persist({
                  ...settings,
                  documentImport: { ...settings.documentImport, defaultMode: option },
                }, t("appSettings.documentImport.saved"))}
              >
                {option === "upload"
                  ? t("appSettings.documentImport.upload")
                  : t("appSettings.documentImport.paste")}
              </button>
            ))}
          </div>
        </div>

        <label className="settings-toggle-row">
          <span>
            <strong>{t("appSettings.documentImport.autoNameLabel")}</strong>
            <small>{t("appSettings.documentImport.autoNameDescription")}</small>
          </span>
          <input
            type="checkbox"
            checked={settings.documentImport.autoNameFromFile}
            onChange={(e) => persist({
              ...settings,
              documentImport: { ...settings.documentImport, autoNameFromFile: e.target.checked },
            }, t("appSettings.documentImport.saved"))}
          />
        </label>

        <label className="settings-toggle-row">
          <span>
            <strong>{t("appSettings.documentImport.trimImportedTextLabel")}</strong>
            <small>{t("appSettings.documentImport.trimImportedTextDescription")}</small>
          </span>
          <input
            type="checkbox"
            checked={settings.documentImport.trimImportedText}
            onChange={(e) => persist({
              ...settings,
              documentImport: { ...settings.documentImport, trimImportedText: e.target.checked },
            }, t("appSettings.documentImport.saved"))}
          />
        </label>

        <label className="settings-toggle-row">
          <span>
            <strong>{t("appSettings.documentImport.warnBeforeEmptyImportLabel")}</strong>
            <small>{t("appSettings.documentImport.warnBeforeEmptyImportDescription")}</small>
          </span>
          <input
            type="checkbox"
            checked={settings.documentImport.warnBeforeEmptyImport}
            onChange={(e) => persist({
              ...settings,
              documentImport: { ...settings.documentImport, warnBeforeEmptyImport: e.target.checked },
            }, t("appSettings.documentImport.saved"))}
          />
        </label>
      </section>

      <section className="settings-section settings-section--wide">
        <div className="settings-section-header">
          <div>
            <h2 className="settings-section-title">Privacy & Security</h2>
          </div>
        </div>

        <label className="settings-toggle-row">
          <span>
            <strong>{t("appSettings.privacy.maskFilePathsLabel")}</strong>
            <small>{t("appSettings.privacy.maskFilePathsDescription")}</small>
          </span>
          <input
            type="checkbox"
            checked={settings.privacy.maskFilePaths}
            onChange={(e) => persist({
              ...settings,
              privacy: { ...settings.privacy, maskFilePaths: e.target.checked },
            }, "Privacy settings saved.")}
          />
        </label>

        <label className="settings-toggle-row">
          <span>
            <strong>{t("appSettings.privacy.clearRecentProjectsOnSignOutLabel")}</strong>
            <small>{t("appSettings.privacy.clearRecentProjectsOnSignOutDescription")}</small>
          </span>
          <input
            type="checkbox"
            checked={settings.privacy.clearRecentProjectsOnSignOut}
            onChange={(e) => persist({
              ...settings,
              privacy: { ...settings.privacy, clearRecentProjectsOnSignOut: e.target.checked },
            }, "Privacy settings saved.")}
          />
        </label>

        <label className="settings-toggle-row">
          <span>
            <strong>{t("appSettings.privacy.forgetLoginIdentitiesOnLogoutLabel")}</strong>
            <small>{t("appSettings.privacy.forgetLoginIdentitiesOnLogoutDescription")}</small>
          </span>
          <input
            type="checkbox"
            checked={settings.privacy.forgetLoginIdentitiesOnLogout}
            onChange={(e) => persist({
              ...settings,
              privacy: { ...settings.privacy, forgetLoginIdentitiesOnLogout: e.target.checked },
            }, "Privacy settings saved.")}
          />
        </label>
      </section>

      <section className="settings-section settings-section--wide">
        <div className="settings-section-header">
          <div>
            <h2 className="settings-section-title">Diagnostics</h2>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">{t("appSettings.diagnostics.appVersion")}</div>
            <div className="settings-row-desc">{appInfo?.appVersion ?? "Loading..."}</div>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">{t("appSettings.diagnostics.localDatabase")}</div>
            <div className="settings-row-desc">
              {dbHealth === "checking"
                ? t("appSettings.diagnostics.databaseChecking")
                : dbHealth === "ok"
                  ? t("appSettings.diagnostics.databaseHealthy")
                  : t("appSettings.diagnostics.databaseUnavailable")}
            </div>
          </div>
          <button className="btn" type="button" onClick={() => void refreshDiagnostics()} disabled={storageBusy}>
            {t("appSettings.diagnostics.recheck")}
          </button>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">{t("appSettings.diagnostics.databaseEndpoint")}</div>
            <div className="settings-row-desc settings-code-line">http://127.0.0.1:8090</div>
          </div>
        </div>
      </section>

      <section className="settings-section settings-section--wide">
        <div className="settings-section-header">
          <div>
            <h2 className="settings-section-title">Update Behavior</h2>
          </div>
        </div>

        <label className="settings-toggle-row">
          <span>
            <strong>{t("appSettings.updates.autoCheckLabel")}</strong>
            <small>{t("appSettings.updates.autoCheckDescription")}</small>
          </span>
          <input
            type="checkbox"
            checked={settings.updates.autoCheck}
            onChange={(e) => persist({
              ...settings,
              updates: { ...settings.updates, autoCheck: e.target.checked },
            }, "Update preferences saved.")}
          />
        </label>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">{t("appSettings.updates.latestReleasesLabel")}</div>
            <div className="settings-row-desc">{t("appSettings.updates.latestReleasesDescription")}</div>
          </div>
          <button
            className="btn"
            type="button"
            onClick={() => void openUrl(GITHUB_RELEASES_URL)}
          >
            {t("appSettings.updates.openReleasesPage")}
          </button>
        </div>

      </section>
        </>
      )}

      {activeSettingsCard && (
        <div className="modal-overlay" onClick={() => setActiveSettingsModal(null)}>
          <div className="modal modal--wide app-settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="settings-section-header">
              <div>
                <h2 className="settings-section-title">{activeSettingsCard.title}</h2>
              </div>
            </div>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                {renderSettingsModalBody(activeSettingsCard.id)}
              </div>
            </div>
            <div className="app-settings-modal-footer">
              {shouldShowAppAutoSaveNotice(activeSettingsCard.id) ? (
                <p className="app-settings-modal-footer-note">{t("appSettings.shell.autoSaveNotice")}</p>
              ) : (
                <span />
              )}
              <button className="btn btn--primary" type="button" onClick={() => setActiveSettingsModal(null)}>
                {t("appSettings.shell.done")}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmEnableNetworkMode && (
        <div className="modal-overlay" onClick={() => !networkSwitching && setConfirmEnableNetworkMode(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t("appSettings.network.enableTitle")}</h2>
            <p className="import-project-copy">
              {t("appSettings.network.enableBody")}
            </p>
            <div className="settings-warning settings-warning--danger">
              {t("appSettings.network.enableWarning")}
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setConfirmEnableNetworkMode(false)}
                disabled={networkSwitching}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => void handleConfirmEnableNetworkMode()}
                disabled={networkSwitching}
              >
                {networkSwitching
                  ? t("appSettings.network.enabling")
                  : t("appSettings.network.enableAction")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
