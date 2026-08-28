import { useCallback, useEffect, useMemo, useState, type DragEvent, type FormEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { copyFile, readDir, stat, writeTextFile } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ActiveThemePreviewRow } from "../components/ActiveThemePreviewRow";
import { LanguageSettingsModal } from "../components/LanguageSettingsModal";
import { ThemeManagerModal } from "../components/ThemeManagerModal";
import { SettingsModal } from "../components/SettingsModal";
import { CloseIcon, DownloadIcon, HelpIcon, LogoutIcon, PlusIcon } from "../components/AppIcons";
import { FilterIcon } from "../components/FilterIcon";
import { LoadingCard } from "../components/LoadingCard";
import { useI18n } from "../i18n/provider";
import {
  formatBytes,
  DEFAULT_APP_SETTINGS,
  readAppSettings,
  saveAppSettings,
  type AppSettings,
  type CloudLlmProvider,
  type LocalLlmProvider,
} from "../lib/appSettings";
import { getAppRuntimeInfo, joinFsPath, type AppRuntimeInfo } from "../lib/dataRoot";
import { buildPermissionMatrixRows, type PermissionMatrixRow } from "../lib/permissionMatrix";
import { notifyPostgresEmbeddingModelDownloadChanged } from "./App_Shell_Helpers";
import { projectLogActionCategory, projectLogActionLabel } from "./Project_Log_View";
import {
  createPostgresAppUser,
  createPostgresProject,
  createPostgresProjectUser,
  createPostgresUpgradeBackup,
  clearPostgresEmbeddingModel,
  deactivatePostgresAppUser,
  deletePostgresProject,
  deletePostgresProjectUser,
  downloadPostgresCustomEmbeddingModel,
  downloadPostgresEmbeddingModel,
  getBundledPostgresStatus,
  getBundledPostgresInitPreflight,
  getPostgresEmbeddingModelDownloadStatus,
  getPostgresEmbeddingModelStatus,
  getPostgresAuthStatus,
  getPostgresInstallationSettings,
  getPostgresStatus,
  getPostgresUserPreferences,
  importPostgresEmbeddingModelFolder,
  listPostgresAdminAuthAuditLog,
  listPostgresAdminProjectAuditLog,
  listPostgresAppUsers,
  listPostgresProjectUsers,
  listPostgresProjects,
  listPostgresUpgradeBackupDiagnostics,
  prepareBundledPostgresRuntimeDirs,
  reactivatePostgresAppUser,
  removePostgresProjectFromState,
  resetPostgresAppUserPassword,
  setPostgresProjectActive,
  setPostgresNetworkMode,
  startBundledPostgresRuntime,
  stopBundledPostgresRuntime,
  savePostgresInstallationSettings,
  savePostgresUserPreferences,
  updatePostgresProjectUser,
  type BundledPostgresStatus,
  type BundledPostgresInitPreflight,
  type PostgresEmbeddingModelDownloadStatus,
  type PostgresEmbeddingModelStatus,
  type PostgresAppUser,
  type PostgresAuthAuditEntry,
  type PostgresAuthSession,
  type PostgresAuthStatus,
  type PostgresAdminProjectLogEntry,
  type PostgresInstallationSettings,
  type PostgresProject,
  type PostgresProjectUser,
  type PostgresStatus,
  type PostgresUpgradeBackupDiagnostics,
  type PostgresUpgradeBackupResult,
  type PostgresUserPreferences,
} from "../lib/postgres";
import {
  applyDensity,
  applyFontSize,
  getStoredTheme,
  getStoredThemeState,
  initTheme,
  setRuntimeThemePreferences,
  type Density,
  type FontSize,
  type Theme,
} from "../theme";

export type PostgresAdminSettingsViewProps = {
  authSession: PostgresAuthSession;
  onOpenProject?: (project: PostgresProject) => Promise<void> | void;
  onSignOut?: () => Promise<void>;
};

type AppSettingsModalId =
  | "language"
  | "appearance"
  | "storage"
  | "network"
  | "aiAssist"
  | "updates"
  | "diagnostics"
  | "administratorLog"
  | "permissions"
  | "addProject"
  | "manageProjects"
  | "addUser"
  | "manageUsers"
  | "administration";
const GITHUB_RELEASES_URL = "https://github.com/KanQual/kanqual/releases";

const CLOUD_LLM_PROVIDER_OPTIONS: Array<{
  value: CloudLlmProvider;
  label: string;
  keyUrl: string;
  helpText: string;
}> = [
  {
    value: "openai",
    label: "OpenAI",
    keyUrl: "https://platform.openai.com/api-keys",
    helpText: "Create a project API key from your OpenAI dashboard.",
  },
  {
    value: "anthropic",
    label: "Anthropic",
    keyUrl: "https://console.anthropic.com/settings/keys",
    helpText: "Create an API key from your Anthropic Console settings.",
  },
  {
    value: "copilot",
    label: "Copilot",
    keyUrl: "https://github.com/settings/personal-access-tokens/new",
    helpText: "Generate a GitHub token that includes the Copilot or GitHub Models access you plan to use.",
  },
  {
    value: "blablador",
    label: "Blablador",
    keyUrl: "https://sdlaml.pages.jsc.fz-juelich.de/ai/guides/blablador_api_access/",
    helpText: "Follow the Blablador token guide to create a personal API token.",
  },
  {
    value: "ollama",
    label: "Ollama",
    keyUrl: "https://ollama.com/settings/keys",
    helpText: "Generate or copy your Ollama cloud key from the Ollama keys page.",
  },
];

const LOCAL_LLM_PROVIDER_OPTIONS: Array<{
  value: LocalLlmProvider;
  label: string;
  helpText: string;
  defaults: Pick<AppSettings["llm"], "ollamaProtocol" | "ollamaHost" | "ollamaPort">;
}> = [
  {
    value: "ollama",
    label: "Ollama",
    helpText: "Uses Ollama's local API.",
    defaults: { ollamaProtocol: "http", ollamaHost: "127.0.0.1", ollamaPort: 11434 },
  },
  {
    value: "llamacpp",
    label: "llama.cpp",
    helpText: "Uses a local OpenAI-compatible /v1 API.",
    defaults: { ollamaProtocol: "http", ollamaHost: "127.0.0.1", ollamaPort: 8080 },
  },
  {
    value: "custom",
    label: "Custom",
    helpText: "Uses a local OpenAI-compatible /v1 API at the configured endpoint.",
    defaults: { ollamaProtocol: "http", ollamaHost: "", ollamaPort: 0 },
  },
];

type SettingsModalSectionProps = {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  tone?: "default" | "warning" | "danger";
  className?: string;
};

function SettingsModalSection({
  title,
  children,
  action,
  tone = "default",
  className = "",
}: SettingsModalSectionProps) {
  return (
    <section className={`app-settings-modal-section${className ? ` ${className}` : ""}`}>
      <div className={`app-settings-modal-section-header app-settings-modal-section-header--${tone}${action ? " app-settings-modal-section-header--with-action" : ""}`}>
        <h3>{title}</h3>
        {action}
      </div>
      {children ? <div className="app-settings-modal-section-body">{children}</div> : null}
    </section>
  );
}

type PingStatus = "idle" | "loading" | "success" | "error";

type PingResult = {
  status: PingStatus;
  ms?: number;
  error?: string;
};

type ExternalIpLookup = {
  status: PingStatus;
  value?: string;
  error?: string;
};

type SortDirection = "asc" | "desc";
type AdminUsersLogSortColumn = "time" | "event" | "outcome" | "user" | "ip" | "reason" | "message";
type AdminProjectsLogSortColumn = "time" | "project" | "user" | "action" | "description";

type OllamaModelSummary = {
  name: string;
  size: number | null;
  modifiedAt: string | null;
};

type OllamaDiscoveryResult = {
  ok: boolean;
  baseUrl: string;
  version: string | null;
  modelCount: number;
  models: OllamaModelSummary[];
  message: string;
};

type CloudLlmModelSummary = {
  id: string;
  name: string;
  publisher: string | null;
};

type CloudLlmDiscoveryResult = {
  ok: boolean;
  provider: string;
  baseUrl: string;
  version: string | null;
  modelCount: number;
  models: CloudLlmModelSummary[];
  message: string;
};

function PostgresNetworkPingBadge({
  result,
  successText,
  errorText,
}: {
  result: PingResult;
  successText: string;
  errorText: string;
}) {
  if (result.status === "idle") return <span className="ping-badge ping-badge--idle">Not tested</span>;
  if (result.status === "loading") return <span className="ping-badge ping-badge--idle">Testing...</span>;
  if (result.status === "success") {
    return (
      <span className="ping-badge ping-badge--ok">
        {successText}
        {typeof result.ms === "number" ? ` ${result.ms} ms` : ""}
      </span>
    );
  }
  return (
    <span className="ping-badge ping-badge--error">
      {errorText}
      {result.error ? ` - ${result.error}` : ""}
    </span>
  );
}

function PostgresNetworkAddressCard({
  label,
  description,
  host,
  port,
  mode,
  statusText,
  copied,
  loading,
  ping,
  disabled,
  copyDisabled,
  testDisabledReason,
  onCopy,
  onTest,
  successText,
  errorText,
}: {
  label: string;
  description?: string;
  host: string | null;
  port: number;
  mode: "device" | "network" | "internet";
  statusText: string;
  copied?: boolean;
  loading?: boolean;
  ping: PingResult;
  disabled?: boolean;
  copyDisabled?: boolean;
  testDisabledReason?: string;
  onCopy: (address: string) => void;
  onTest: () => void;
  successText: string;
  errorText: string;
}) {
  const address = host ? `${host}:${port}` : null;
  const testDisabled = !address || disabled || ping.status === "loading";
  return (
    <div className={`network-address-card network-address-card--${mode}`}>
      <div className="network-address-card-main">
        <div className="settings-row-info">
          <div className="settings-row-label">{label}</div>
          {description ? <div className="settings-row-desc">{description}</div> : null}
        </div>
        <span className="network-address-card-status">{statusText}</span>
      </div>
      <div className="network-address-card-actions">
        <code className="settings-code-line network-address-code">
          {loading ? "Detecting..." : (address ?? "Unavailable")}
        </code>
        <div className="network-address-card-buttons">
          <button className="btn btn--sm" type="button" disabled={!address || copyDisabled} onClick={() => address && onCopy(address)}>
            {copied ? "Copied" : "Copy"}
          </button>
          <button className="btn btn--sm btn--primary" type="button" disabled={testDisabled} title={testDisabledReason} onClick={onTest}>
            {ping.status === "loading" ? "Testing..." : "Test"}
          </button>
        </div>
      </div>
      <div className="network-address-card-footer">
        <PostgresNetworkPingBadge result={ping} successText={successText} errorText={errorText} />
        {testDisabledReason && testDisabled ? <span className="network-address-card-note">{testDisabledReason}</span> : null}
      </div>
    </div>
  );
}

function PasswordVisibilityIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="password-visibility-icon">
      <path
        d="M2 12s3.5-6 10-6s10 6 10 6s-3.5 6-10 6s-10-6-10-6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} focusable="false">
      <path
        fill="currentColor"
        d="M9.2 16.2 4.8 11.8l-1.4 1.4 5.8 5.8L21 7.2l-1.4-1.4z"
      />
    </svg>
  );
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function clampSettingsInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numberValue)));
}

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

function formatStorageFileSummary(count: number, directory: string): string {
  return `${count.toLocaleString()} files in ${directory}`;
}

function syncLegacyAppSettingsFromPostgresInstallationSettings(
  installationSettings: PostgresInstallationSettings,
): void {
  const current = readAppSettings();
  saveAppSettings({
    ...current,
    startup: {
      ...current.startup,
      reopenLastProject: installationSettings.startupReopenLastProject,
    },
    documentImport: {
      ...current.documentImport,
      defaultMode: installationSettings.documentImportDefaultMode,
      autoNameFromFile: true,
      trimImportedText: installationSettings.documentImportTrimImportedText,
      warnBeforeEmptyImport: true,
    },
    privacy: {
      ...current.privacy,
      maskFilePaths: false,
      clearRecentProjectsOnSignOut: false,
    },
    updates: {
      ...current.updates,
      autoCheck: installationSettings.updatesAutoCheck,
    },
    llm: {
      ...current.llm,
      ...installationSettings.llm,
    },
  });
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

function formatPostgresTimestampMs(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "-";
  return formatPostgresDateTime(new Date(value).toISOString());
}

function compareAdminLogText(left: string | null | undefined, right: string | null | undefined): number {
  return String(left ?? "").localeCompare(String(right ?? ""), undefined, { sensitivity: "base", numeric: true });
}

function sortIcon(active: boolean, direction: SortDirection): string {
  if (!active) return " ↕";
  return direction === "asc" ? " ↑" : " ↓";
}

function csvCell(value: string | number | null | undefined): string {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function matchesAdminLogFilter(value: string | number | null | undefined, filter: string): boolean {
  const trimmed = filter.trim();
  if (!trimmed) return true;
  return String(value ?? "").toLowerCase().includes(trimmed.toLowerCase());
}

function yesNo(value: boolean | null | undefined): string {
  if (value == null) return "-";
  return value ? "Yes" : "No";
}

function postgresUserLoginAccessLabel(user: PostgresAppUser): string {
  if (!user.active) return "Disabled";
  if (user.loginPermanentlyBlocked) return "Permanently blocked";
  if (user.loginBlockedUntilMs && user.loginBlockedUntilMs > Date.now()) return "Temporarily blocked";
  return "Allowed";
}

function postgresUserIsLoginBlocked(user: PostgresAppUser): boolean {
  return user.loginPermanentlyBlocked || Boolean(user.loginBlockedUntilMs && user.loginBlockedUntilMs > Date.now());
}

export function PostgresAdminSettingsView({
  authSession,
  onOpenProject,
  onSignOut,
}: PostgresAdminSettingsViewProps) {
  const { locale, setLocale, t } = useI18n();
  const [activeModal, setActiveModal] = useState<AppSettingsModalId | null>(null);
  const [showThemeManager, setShowThemeManager] = useState(false);
  const [installationSettings, setInstallationSettings] = useState<PostgresInstallationSettings | null>(null);
  const [status, setStatus] = useState<PostgresStatus | null>(null);
  const [bundledPostgresStatus, setBundledPostgresStatus] = useState<BundledPostgresStatus | null>(null);
  const [bundledPostgresPreflight, setBundledPostgresPreflight] = useState<BundledPostgresInitPreflight | null>(null);
  const [authStatus, setAuthStatus] = useState<PostgresAuthStatus | null>(null);
  const [projects, setProjects] = useState<PostgresProject[]>([]);
  const [appUsers, setAppUsers] = useState<PostgresAppUser[]>([]);
  const [appInfo, setAppInfo] = useState<AppRuntimeInfo | null>(null);
  const [storageSummary, setStorageSummary] = useState({
    databaseBytes: 0,
    databaseFiles: 0,
    backupBytes: 0,
    backupFiles: 0,
  });
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [runtimeNotice, setRuntimeNotice] = useState("");
  const [error, setError] = useState("");
  const [networkNotice, setNetworkNotice] = useState("");
  const [networkError, setNetworkError] = useState("");
  const [aiAssistNotice, setAiAssistNotice] = useState("");
  const [aiAssistError, setAiAssistError] = useState("");
  const [updatesNotice, setUpdatesNotice] = useState("");
  const [updatesError, setUpdatesError] = useState("");
  const [showUpgradeBackupSuccessModal, setShowUpgradeBackupSuccessModal] = useState(false);
  const [showUpgradeBackupPasswordModal, setShowUpgradeBackupPasswordModal] = useState(false);
  const [upgradeBackupPassword, setUpgradeBackupPassword] = useState("");
  const [upgradeBackupPasswordVisible, setUpgradeBackupPasswordVisible] = useState(false);
  const [upgradeBackupSubmitting, setUpgradeBackupSubmitting] = useState(false);
  const [lastUpgradeBackup, setLastUpgradeBackup] = useState<PostgresUpgradeBackupResult | null>(null);
  const [upgradeBackupDiagnostics, setUpgradeBackupDiagnostics] = useState<PostgresUpgradeBackupDiagnostics | null>(null);
  const [upgradeBackupDiagnosticsLoading, setUpgradeBackupDiagnosticsLoading] = useState(false);
  const [upgradeBackupCopying, setUpgradeBackupCopying] = useState(false);
  const [upgradeBackupCopyNotice, setUpgradeBackupCopyNotice] = useState("");
  const [upgradeBackupCopyError, setUpgradeBackupCopyError] = useState("");
  const [theme, setTheme] = useState<Theme>("light");
  const [density, setDensity] = useState<Density>("comfortable");
  const [fontSize, setFontSize] = useState<FontSize>("normal");
  const [sourceTextSizePx, setSourceTextSizePx] = useState(15);
  const [recentProjectLimit, setRecentProjectLimit] = useState(10);
  const [networkSwitching, setNetworkSwitching] = useState(false);
  const [confirmEnableNetworkMode, setConfirmEnableNetworkMode] = useState(false);
  const [pendingNetworkMode, setPendingNetworkMode] = useState<"network" | "internet">("network");
  const [internetModeConfirmation, setInternetModeConfirmation] = useState("");
  const [lanPing, setLanPing] = useState<PingResult>({ status: "idle" });
  const [internetPing, setInternetPing] = useState<PingResult>({ status: "idle" });
  const [externalIp, setExternalIp] = useState<ExternalIpLookup>({ status: "idle" });
  const [copiedNetworkAddress, setCopiedNetworkAddress] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [addProjectTab, setAddProjectTab] = useState<"details" | "members">("details");
  const [addProjectName, setAddProjectName] = useState("");
  const [addProjectDescription, setAddProjectDescription] = useState("");
  const [addProjectUserRoles, setAddProjectUserRoles] = useState<Record<string, string>>({});
  const [creatingProject, setCreatingProject] = useState(false);
  const [addUserTab, setAddUserTab] = useState<"account" | "projects">("account");
  const [addUserUsername, setAddUserUsername] = useState("");
  const [addUserPassword, setAddUserPassword] = useState("");
  const [addUserPasswordConfirm, setAddUserPasswordConfirm] = useState("");
  const [addUserPasswordVisible, setAddUserPasswordVisible] = useState(false);
  const [addUserPasswordConfirmVisible, setAddUserPasswordConfirmVisible] = useState(false);
  const [addUserProjectRoles, setAddUserProjectRoles] = useState<Record<string, string>>({});
  const [creatingUser, setCreatingUser] = useState(false);
  const [projectMemberships, setProjectMemberships] = useState<PostgresProjectUser[]>([]);
  const [loadingProjectMemberships, setLoadingProjectMemberships] = useState(false);
  const [projectAccessWarning, setProjectAccessWarning] = useState<{
    action: "disable" | "enable" | "delete";
    project: PostgresProject;
  } | null>(null);
  const [updatingProjectStatusId, setUpdatingProjectStatusId] = useState("");
  const [deletingProjectId, setDeletingProjectId] = useState("");
  const [openingProjectId, setOpeningProjectId] = useState("");
  const [manageProjectMenu, setManageProjectMenu] = useState<{
    projectId: string;
    x: number;
    y: number;
  } | null>(null);
  const [updatingMembershipId, setUpdatingMembershipId] = useState("");
  const [removingMembershipId, setRemovingMembershipId] = useState("");
  const [addingMembershipProjectId, setAddingMembershipProjectId] = useState("");
  const [deactivatingUserId, setDeactivatingUserId] = useState("");
  const [reactivatingUserId, setReactivatingUserId] = useState("");
  const [manageUserMenu, setManageUserMenu] = useState<{
    userId: string;
    x: number;
    y: number;
  } | null>(null);
  const [userAccessWarning, setUserAccessWarning] = useState<{
    action: "disable" | "enable";
    user: PostgresAppUser;
  } | null>(null);
  const [resetPasswordUser, setResetPasswordUser] = useState<PostgresAppUser | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetPasswordConfirmValue, setResetPasswordConfirmValue] = useState("");
  const [resetPasswordVisible, setResetPasswordVisible] = useState(false);
  const [resetPasswordConfirmVisible, setResetPasswordConfirmVisible] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [requiredResetUserId, setRequiredResetUserId] = useState("");
  const [membershipUser, setMembershipUser] = useState<PostgresAppUser | null>(null);
  const [membershipRemovalWarning, setMembershipRemovalWarning] = useState<PostgresProjectUser | null>(null);
  const [membershipNotice, setMembershipNotice] = useState("");
  const [membershipError, setMembershipError] = useState("");
  const [aiAssistAdminTab, setAiAssistAdminTab] = useState<"usage" | "embeddings" | "llms">("usage");
  const [aiAssistPolicySaving, setAiAssistPolicySaving] = useState(false);
  const [embeddingModelStatus, setEmbeddingModelStatus] = useState<PostgresEmbeddingModelStatus | null>(null);
  const [embeddingModelDownloadStatus, setEmbeddingModelDownloadStatus] = useState<PostgresEmbeddingModelDownloadStatus | null>(null);
  const [embeddingModelSubmitting, setEmbeddingModelSubmitting] = useState<"download" | "custom-download" | "import" | "clear" | null>(null);
  const [customEmbeddingModelUrl, setCustomEmbeddingModelUrl] = useState("");
  const [activeEmbeddingModelModal, setActiveEmbeddingModelModal] = useState<"download" | "folder" | null>(null);
  const [customEmbeddingFolderPath, setCustomEmbeddingFolderPath] = useState("");
  const [adminLocalModels, setAdminLocalModels] = useState<OllamaModelSummary[]>([]);
  const [adminCloudModels, setAdminCloudModels] = useState<CloudLlmModelSummary[]>([]);
  const [adminLocalModelsBusy, setAdminLocalModelsBusy] = useState(false);
  const [adminCloudModelsBusy, setAdminCloudModelsBusy] = useState(false);
  const [localProviderModalOpen, setLocalProviderModalOpen] = useState(false);
  const [localProviderDraft, setLocalProviderDraft] = useState<AppSettings["llm"] | null>(null);
  const [localProviderMenu, setLocalProviderMenu] = useState<{ x: number; y: number } | null>(null);
  const [cloudProviderModalOpen, setCloudProviderModalOpen] = useState(false);
  const [cloudProviderDraft, setCloudProviderDraft] = useState<AppSettings["llm"] | null>(null);
  const [cloudProviderMenu, setCloudProviderMenu] = useState<{ x: number; y: number } | null>(null);
  const [adminAuditTab, setAdminAuditTab] = useState<"auth" | "projects">("auth");
  const [adminUsersLogSortColumn, setAdminUsersLogSortColumn] = useState<AdminUsersLogSortColumn>("time");
  const [adminUsersLogSortDirection, setAdminUsersLogSortDirection] = useState<SortDirection>("desc");
  const [adminProjectsLogSortColumn, setAdminProjectsLogSortColumn] = useState<AdminProjectsLogSortColumn>("time");
  const [adminProjectsLogSortDirection, setAdminProjectsLogSortDirection] = useState<SortDirection>("desc");
  const [adminLogFilterOpen, setAdminLogFilterOpen] = useState(false);
  const [adminUsersLogFilters, setAdminUsersLogFilters] = useState<Record<AdminUsersLogSortColumn, string>>({
    time: "",
    event: "",
    outcome: "",
    user: "",
    ip: "",
    reason: "",
    message: "",
  });
  const [adminProjectsLogFilters, setAdminProjectsLogFilters] = useState<Record<AdminProjectsLogSortColumn, string>>({
    time: "",
    project: "",
    user: "",
    action: "",
    description: "",
  });
  const [authAuditEntries, setAuthAuditEntries] = useState<PostgresAuthAuditEntry[]>([]);
  const [projectAuditEntries, setProjectAuditEntries] = useState<PostgresAdminProjectLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");
  const databaseAccountStatus =
    authSession.authKind === "postgres_admin"
      ? "PostgreSQL superuser"
      : "App account (not PostgreSQL superuser)";

  const settingsOverviewCards: Array<{
    id: AppSettingsModalId;
    title: string;
    description: string;
    icon: string;
    tone: "default" | "network" | "admin";
  }> = [
    {
      id: "language",
      title: t("appSettings.sectionTitles.language"),
      description: t("appSettings.overview.language"),
      icon: "L",
      tone: "default" as const,
    },
    {
      id: "appearance",
      title: "Appearance",
      description: "Adjust the interface theme, density, and text size.",
      icon: "A",
      tone: "default" as const,
    },
    {
      id: "storage",
      title: t("appSettings.storage.localStorageTitle"),
      description: t("appSettings.overview.storage"),
      icon: "S",
      tone: "default" as const,
    },
    {
      id: "updates",
      title: "Back-up and Updates",
      description: t("appSettings.overview.updates"),
      icon: "U",
      tone: "admin" as const,
    },
    {
      id: "diagnostics",
      title: "Database",
      description: t("appSettings.overview.diagnostics"),
      icon: "D",
      tone: "default" as const,
    },
    {
      id: "administratorLog",
      title: "Administrator Log",
      description: "Review authentication events and merged project activity.",
      icon: "Log",
      tone: "admin" as const,
    },
    {
      id: "network",
      title: t("appSettings.sectionTitles.network"),
      description: t("appSettings.overview.network"),
      icon: "N",
      tone: "admin" as const,
    },
    {
      id: "aiAssist",
      title: "AI Assist",
      description: "Control server-wide and project-level AI Assist availability.",
      icon: "AI",
      tone: "admin" as const,
    },
    {
      id: "permissions",
      title: t("appSettings.permissions.title"),
      description: t("appSettings.permissions.description"),
      icon: "R",
      tone: "default" as const,
    },
    {
      id: "addProject",
      title: "Add Project",
      description: "Create a project and assign initial project members.",
      icon: "+P",
      tone: "admin" as const,
    },
    {
      id: "manageProjects",
      title: "Manage Projects",
      description: "Open, disable, or delete project workspaces.",
      icon: "P",
      tone: "admin" as const,
    },
    {
      id: "addUser",
      title: "Add User",
      description: "Create a PostgreSQL user and assign project roles.",
      icon: "+U",
      tone: "admin" as const,
    },
    {
      id: "manageUsers",
      title: "Manage Users",
      description: "Review accounts, project access, roles, and password resets.",
      icon: "U",
      tone: "admin" as const,
    },
  ];

  const appSettingsCardById = new Map(settingsOverviewCards.map((card) => [card.id, card]));
  const appSettingsSectionSpecs: Array<{
    id: string;
    sectionHeading: string;
    cardIds: AppSettingsModalId[];
  }> = [
    {
      id: "user-roles",
      sectionHeading: "Users",
      cardIds: ["addUser", "manageUsers", "permissions"],
    },
    {
      id: "projects",
      sectionHeading: "Projects",
      cardIds: ["addProject", "manageProjects"],
    },
    {
      id: "features",
      sectionHeading: "Features",
      cardIds: ["aiAssist", "network"],
    },
    {
      id: "system",
      sectionHeading: "System",
      cardIds: ["administratorLog", "diagnostics", "storage", "updates"],
    },
    {
      id: "preferences",
      sectionHeading: "Preferences",
      cardIds: ["appearance", "language"],
    },
  ];
  const appSettingsSections = appSettingsSectionSpecs
    .map((section) => ({
      ...section,
      cards: section.cardIds
        .map((cardId) => appSettingsCardById.get(cardId))
        .filter((card): card is NonNullable<typeof card> => Boolean(card)),
    }))
    .filter((section) => section.cards.length > 0);

  const permissionMatrixRowsForLocale = useMemo(() => buildPermissionMatrixRows(t), [t]);
  const permissionMatrixByCategory = useMemo(() => {
    return permissionMatrixRowsForLocale.reduce<Record<string, PermissionMatrixRow[]>>((acc, row) => {
      if (!acc[row.category]) acc[row.category] = [];
      acc[row.category].push(row);
      return acc;
    }, {});
  }, [permissionMatrixRowsForLocale]);
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const manageProjectMenuProject = manageProjectMenu ? projectById.get(manageProjectMenu.projectId) ?? null : null;
  const manageUserMenuUser = manageUserMenu ? appUsers.find((user) => user.id === manageUserMenu.userId) ?? null : null;
  const membershipsByAppUserId = useMemo(() => {
    return projectMemberships.reduce<Record<string, PostgresProjectUser[]>>((acc, membership) => {
      if (!acc[membership.appUserId]) acc[membership.appUserId] = [];
      acc[membership.appUserId].push(membership);
      return acc;
    }, {});
  }, [projectMemberships]);
  const sortedAuthAuditEntries = useMemo(() => {
    return authAuditEntries.filter((entry) => {
      const eventLabel = entry.event.replace(/^postgres\.auth\./, "");
      return matchesAdminLogFilter(formatPostgresTimestampMs(entry.timestampMs), adminUsersLogFilters.time)
        && matchesAdminLogFilter(eventLabel, adminUsersLogFilters.event)
        && matchesAdminLogFilter(entry.outcome, adminUsersLogFilters.outcome)
        && matchesAdminLogFilter(entry.username || entry.userId, adminUsersLogFilters.user)
        && matchesAdminLogFilter(entry.clientIp, adminUsersLogFilters.ip)
        && matchesAdminLogFilter(entry.reason, adminUsersLogFilters.reason)
        && matchesAdminLogFilter(entry.message, adminUsersLogFilters.message);
    }).sort((left, right) => {
      let comparison = 0;
      if (adminUsersLogSortColumn === "time") {
        comparison = left.timestampMs - right.timestampMs;
      } else if (adminUsersLogSortColumn === "event") {
        comparison = compareAdminLogText(left.event.replace(/^postgres\.auth\./, ""), right.event.replace(/^postgres\.auth\./, ""));
      } else if (adminUsersLogSortColumn === "outcome") {
        comparison = compareAdminLogText(left.outcome, right.outcome);
      } else if (adminUsersLogSortColumn === "user") {
        comparison = compareAdminLogText(left.username || left.userId, right.username || right.userId);
      } else if (adminUsersLogSortColumn === "ip") {
        comparison = compareAdminLogText(left.clientIp, right.clientIp);
      } else if (adminUsersLogSortColumn === "reason") {
        comparison = compareAdminLogText(left.reason, right.reason);
      } else if (adminUsersLogSortColumn === "message") {
        comparison = compareAdminLogText(left.message, right.message);
      }
      return adminUsersLogSortDirection === "asc" ? comparison : -comparison;
    });
  }, [adminUsersLogFilters, adminUsersLogSortColumn, adminUsersLogSortDirection, authAuditEntries]);
  const sortedProjectAuditEntries = useMemo(() => {
    return projectAuditEntries.filter((entry) => {
      return matchesAdminLogFilter(formatPostgresDateTime(entry.occurredAt), adminProjectsLogFilters.time)
        && matchesAdminLogFilter(entry.projectName || entry.projectId, adminProjectsLogFilters.project)
        && matchesAdminLogFilter(entry.userName || entry.userId, adminProjectsLogFilters.user)
        && matchesAdminLogFilter(projectLogActionLabel(entry.action, t), adminProjectsLogFilters.action)
        && matchesAdminLogFilter(entry.label, adminProjectsLogFilters.description);
    }).sort((left, right) => {
      let comparison = 0;
      if (adminProjectsLogSortColumn === "time") {
        comparison = new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime();
      } else if (adminProjectsLogSortColumn === "project") {
        comparison = compareAdminLogText(left.projectName || left.projectId, right.projectName || right.projectId);
      } else if (adminProjectsLogSortColumn === "user") {
        comparison = compareAdminLogText(left.userName || left.userId, right.userName || right.userId);
      } else if (adminProjectsLogSortColumn === "action") {
        comparison = compareAdminLogText(projectLogActionLabel(left.action, t), projectLogActionLabel(right.action, t));
      } else if (adminProjectsLogSortColumn === "description") {
        comparison = compareAdminLogText(left.label, right.label);
      }
      return adminProjectsLogSortDirection === "asc" ? comparison : -comparison;
    });
  }, [adminProjectsLogFilters, adminProjectsLogSortColumn, adminProjectsLogSortDirection, projectAuditEntries, t]);
  const addUserPasswordMismatch =
    addUserPasswordConfirm.length > 0 && addUserPassword !== addUserPasswordConfirm;
  const aiAssistPolicyMode = installationSettings?.aiAssistPolicy.mode ?? "disabled";
  const embeddingDownloadPhase = embeddingModelDownloadStatus?.phase ?? "idle";
  const embeddingDownloadBusy = embeddingDownloadPhase === "downloading" || embeddingDownloadPhase === "cancelling";
  const hasEmbeddingModel = Boolean(embeddingModelStatus?.installed);
  const activeEmbeddingModelIsDefault =
    hasEmbeddingModel && embeddingModelStatus?.repoId === "intfloat/multilingual-e5-large";
  const activeCustomEmbeddingModel =
    hasEmbeddingModel && !activeEmbeddingModelIsDefault ? embeddingModelStatus : null;
  const hasPartialEmbeddingModel =
    Boolean(embeddingModelStatus && !embeddingModelStatus.installed && embeddingModelStatus.files > 0);
  const partialEmbeddingModelIsDefault =
    hasPartialEmbeddingModel && embeddingModelStatus?.repoId === "intfloat/multilingual-e5-large";
  const partialCustomEmbeddingModel =
    hasPartialEmbeddingModel && !partialEmbeddingModelIsDefault ? embeddingModelStatus : null;
  const aiAssistLlmSettings = installationSettings?.llm;
  const aiAssistSetupDisabled = aiAssistPolicyMode === "disabled";
  const savedLocalLlmProvider =
    aiAssistLlmSettings?.ollamaEnabled
      ? LOCAL_LLM_PROVIDER_OPTIONS.find((provider) => provider.value === aiAssistLlmSettings.localProvider) ?? null
      : null;
  const selectedLocalLlmProvider =
    localProviderDraft
      ? LOCAL_LLM_PROVIDER_OPTIONS.find((provider) => provider.value === localProviderDraft.localProvider) ?? null
      : null;
  const selectedCloudLlmProvider =
    cloudProviderDraft
      ? CLOUD_LLM_PROVIDER_OPTIONS.find((provider) => provider.value === cloudProviderDraft.cloudProvider) ?? null
      : null;
  const savedCloudLlmProvider =
    aiAssistLlmSettings?.connectionMode === "cloud"
      ? CLOUD_LLM_PROVIDER_OPTIONS.find((provider) => provider.value === aiAssistLlmSettings.cloudProvider) ?? null
      : null;
  const savedLocalEnabledModels = aiAssistLlmSettings && savedLocalLlmProvider
    ? aiAssistLlmSettings.localEnabledModelsByProvider[aiAssistLlmSettings.localProvider] ?? []
    : [];
  const adminLocalEnabledModels = localProviderDraft
    ? localProviderDraft.localEnabledModelsByProvider[localProviderDraft.localProvider]
    : undefined;
  const savedCloudEnabledModels = aiAssistLlmSettings && savedCloudLlmProvider
    ? aiAssistLlmSettings.cloudEnabledModelsByProvider[aiAssistLlmSettings.cloudProvider] ?? []
    : [];
  const adminCloudEnabledModels = cloudProviderDraft
    ? cloudProviderDraft.cloudEnabledModelsByProvider[cloudProviderDraft.cloudProvider]
    : undefined;

  function toggleAdminUsersLogSort(column: AdminUsersLogSortColumn) {
    if (adminUsersLogSortColumn === column) {
      setAdminUsersLogSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setAdminUsersLogSortColumn(column);
    setAdminUsersLogSortDirection(column === "time" ? "desc" : "asc");
  }

  function toggleAdminProjectsLogSort(column: AdminProjectsLogSortColumn) {
    if (adminProjectsLogSortColumn === column) {
      setAdminProjectsLogSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setAdminProjectsLogSortColumn(column);
    setAdminProjectsLogSortDirection(column === "time" ? "desc" : "asc");
  }

  async function handleExportAdminLogCsv() {
    setAuditError("");
    try {
      const tableName = adminAuditTab === "auth" ? "users" : "projects";
      const outputPath = await saveDialog({
        title: `Export administrator ${tableName} log`,
        defaultPath: `kanqual-administrator-${tableName}-log.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (typeof outputPath !== "string") return;
      const rows = adminAuditTab === "auth"
        ? [
            ["Time", "Event", "Outcome", "User", "IP Address", "Reason", "Message"].map(csvCell).join(","),
            ...sortedAuthAuditEntries.map((entry) => [
              formatPostgresTimestampMs(entry.timestampMs),
              entry.event.replace(/^postgres\.auth\./, ""),
              entry.outcome,
              entry.username || entry.userId || "",
              entry.clientIp || "",
              entry.reason || "",
              entry.message || "",
            ].map(csvCell).join(",")),
          ]
        : [
            ["Time", "Project", "User", "Action", "Description"].map(csvCell).join(","),
            ...sortedProjectAuditEntries.map((entry) => [
              formatPostgresDateTime(entry.occurredAt),
              entry.projectName || entry.projectId,
              entry.userName || entry.userId || "",
              projectLogActionLabel(entry.action, t),
              entry.label || "",
            ].map(csvCell).join(",")),
          ];
      await writeTextFile(outputPath, rows.join("\n"));
    } catch (exportError) {
      setAuditError(`Could not export administrator log: ${describeUnknownError(exportError)}`);
    }
  }

  function handleInspectUserLoginAttempts(user: PostgresAppUser) {
    setManageUserMenu(null);
    setAdminAuditTab("auth");
    setAdminUsersLogFilters({
      time: "",
      event: "login",
      outcome: "",
      user: user.username,
      ip: "",
      reason: "",
      message: "",
    });
    setAdminUsersLogSortColumn("time");
    setAdminUsersLogSortDirection("desc");
    setActiveModal("administratorLog");
    void refreshAdminAuditLogs();
  }

  function notifyEmbeddingModelDownloadChanged(detail?: {
    status?: PostgresEmbeddingModelDownloadStatus;
    retry?: { kind: "default" } | { kind: "custom"; modelUrl: string };
  }) {
    notifyPostgresEmbeddingModelDownloadChanged(detail);
  }

  function formatEmbeddingModelDate(value: number | null | undefined): string {
    if (!value) return "-";
    return formatPostgresDateTime(new Date(value).toISOString());
  }

  const persistInstallationSettings = useCallback(async (
    next: PostgresInstallationSettings,
    successMessage: string,
  ) => {
    const saved = await savePostgresInstallationSettings(next);
    setInstallationSettings(saved);
    syncLegacyAppSettingsFromPostgresInstallationSettings(saved);
    setNotice(successMessage);
    setError("");
  }, []);

  const loadUpgradeBackupDiagnostics = useCallback(async () => {
    setUpgradeBackupDiagnosticsLoading(true);
    try {
      const diagnostics = await listPostgresUpgradeBackupDiagnostics();
      setUpgradeBackupDiagnostics(diagnostics);
    } catch (diagnosticsError) {
      setUpdatesError(describeUnknownError(diagnosticsError));
    } finally {
      setUpgradeBackupDiagnosticsLoading(false);
    }
  }, []);

  async function handleCreateUpgradeBackup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (upgradeBackupSubmitting) return;
    if (!upgradeBackupPassword.trim()) {
      setUpdatesError("Enter the administrator password to create a backup.");
      setUpdatesNotice("");
      return;
    }

    setUpgradeBackupSubmitting(true);
    setUpdatesError("");
    setUpdatesNotice("");
    setLastUpgradeBackup(null);
    setUpgradeBackupCopyNotice("");
    setUpgradeBackupCopyError("");
    try {
      const result = await createPostgresUpgradeBackup(upgradeBackupPassword);
      setLastUpgradeBackup(result);
      setUpgradeBackupPassword("");
      setUpgradeBackupPasswordVisible(false);
      setShowUpgradeBackupPasswordModal(false);
      setShowUpgradeBackupSuccessModal(true);
      setUpdatesNotice("Upgrade backup created.");
      void loadUpgradeBackupDiagnostics();
    } catch (backupError) {
      setUpdatesError(describeUnknownError(backupError));
    } finally {
      setUpgradeBackupSubmitting(false);
    }
  }

  async function handleCopyLastUpgradeBackup() {
    if (!lastUpgradeBackup || upgradeBackupCopying) return;
    setUpgradeBackupCopying(true);
    setUpgradeBackupCopyNotice("");
    setUpgradeBackupCopyError("");
    try {
      const sourceName = lastUpgradeBackup.path.split(/[\\/]/).pop() || `kanqual-upgrade-backup-${lastUpgradeBackup.createdAtMs}.kanqual-upgrade-backup`;
      const outputPath = await saveDialog({
        title: "Copy KanQual backup",
        defaultPath: sourceName,
        filters: [
          {
            name: "KanQual upgrade backup",
            extensions: ["kanqual-upgrade-backup"],
          },
        ],
      });
      if (typeof outputPath !== "string") return;
      await copyFile(lastUpgradeBackup.path, outputPath);
      setUpgradeBackupCopyNotice("Backup copy created.");
    } catch (copyError) {
      setUpgradeBackupCopyError(describeUnknownError(copyError));
    } finally {
      setUpgradeBackupCopying(false);
    }
  }

  async function persistAiAssistPolicy(
    nextPolicy: PostgresInstallationSettings["aiAssistPolicy"],
    successMessage: string,
  ) {
    if (!installationSettings || aiAssistPolicySaving) return;
    setAiAssistPolicySaving(true);
    setAiAssistNotice("");
    setAiAssistError("");
    try {
      const saved = await savePostgresInstallationSettings({
        ...installationSettings,
        aiAssistPolicy: nextPolicy,
      });
      setInstallationSettings(saved);
      syncLegacyAppSettingsFromPostgresInstallationSettings(saved);
      setAiAssistNotice(successMessage);
    } catch (saveError) {
      setAiAssistError(describeUnknownError(saveError));
    } finally {
      setAiAssistPolicySaving(false);
    }
  }

  async function persistAiAssistLlmSettings(
    nextLlmSettings: AppSettings["llm"],
    successMessage = "LLM settings saved.",
  ) {
    if (!installationSettings || aiAssistPolicySaving) return;
    setAiAssistPolicySaving(true);
    setAiAssistNotice("");
    setAiAssistError("");
    try {
      const saved = await savePostgresInstallationSettings({
        ...installationSettings,
        llm: nextLlmSettings,
      });
      setInstallationSettings(saved);
      syncLegacyAppSettingsFromPostgresInstallationSettings(saved);
      setAiAssistNotice(successMessage);
    } catch (saveError) {
      setAiAssistError(describeUnknownError(saveError));
    } finally {
      setAiAssistPolicySaving(false);
    }
  }

  function updateAiAssistLlmSettings(
    updater: (current: AppSettings["llm"]) => AppSettings["llm"],
    successMessage?: string,
  ) {
    if (!installationSettings) return;
    void persistAiAssistLlmSettings(updater(installationSettings.llm), successMessage);
  }

  function openLocalProviderModal() {
    if (!aiAssistLlmSettings) return;
    const provider = aiAssistLlmSettings.ollamaEnabled
      ? aiAssistLlmSettings.localProvider
      : "ollama";
    const profile = LOCAL_LLM_PROVIDER_OPTIONS.find((option) => option.value === provider) ?? LOCAL_LLM_PROVIDER_OPTIONS[0];
    const draft: AppSettings["llm"] = {
      ...aiAssistLlmSettings,
      ...(aiAssistLlmSettings.ollamaEnabled ? {} : profile.defaults),
      connectionMode: "local",
      ollamaEnabled: true,
      localProvider: provider,
      ollamaSelectedModel: aiAssistLlmSettings.localSelectedModelsByProvider[provider] ?? "",
    };
    const savedModels = draft.localEnabledModelsByProvider[provider] ?? [];
    setAdminLocalModels(savedModels.map((name) => ({ name, size: null, modifiedAt: null })));
    setLocalProviderDraft(draft);
    setAiAssistNotice("");
    setAiAssistError("");
    setLocalProviderModalOpen(true);
  }

  function closeLocalProviderModal() {
    if (adminLocalModelsBusy || aiAssistPolicySaving) return;
    setLocalProviderModalOpen(false);
    setLocalProviderDraft(null);
    setAdminLocalModels([]);
  }

  function updateLocalProviderDraft(updater: (current: AppSettings["llm"]) => AppSettings["llm"]) {
    setLocalProviderDraft((current) => current ? updater(current) : current);
  }

  function handleAdminLocalLlmProviderChange(provider: LocalLlmProvider) {
    setAdminLocalModels([]);
    const profile = LOCAL_LLM_PROVIDER_OPTIONS.find((option) => option.value === provider) ?? LOCAL_LLM_PROVIDER_OPTIONS[0];
    updateLocalProviderDraft((current) => ({
      ...current,
      ...profile.defaults,
      connectionMode: "local",
      ollamaEnabled: true,
      localProvider: provider,
      ollamaSelectedModel: current.localSelectedModelsByProvider[provider] ?? "",
    }));
  }

  async function saveLocalProviderDraft() {
    if (!localProviderDraft) return;
    await persistAiAssistLlmSettings({
      ...localProviderDraft,
      connectionMode: "local",
      ollamaEnabled: true,
    }, "Local provider saved.");
    setLocalProviderModalOpen(false);
    setLocalProviderDraft(null);
    setAdminLocalModels([]);
  }

  async function removeLocalProvider() {
    if (!aiAssistLlmSettings) return;
    const defaults = DEFAULT_APP_SETTINGS.llm;
    await persistAiAssistLlmSettings({
      ...aiAssistLlmSettings,
      connectionMode: aiAssistLlmSettings.connectionMode === "local" ? "none" : aiAssistLlmSettings.connectionMode,
      ollamaEnabled: false,
      localProvider: defaults.localProvider,
      ollamaProtocol: defaults.ollamaProtocol,
      ollamaHost: defaults.ollamaHost,
      ollamaPort: defaults.ollamaPort,
      ollamaSelectedModel: "",
      localSelectedModelsByProvider: {},
      localEnabledModelsByProvider: {},
    }, "Local provider removed.");
    setLocalProviderMenu(null);
    setLocalProviderModalOpen(false);
    setLocalProviderDraft(null);
    setAdminLocalModels([]);
  }

  function openCloudProviderModal() {
    if (!aiAssistLlmSettings) return;
    const provider = aiAssistLlmSettings.connectionMode === "cloud"
      ? aiAssistLlmSettings.cloudProvider
      : CLOUD_LLM_PROVIDER_OPTIONS[0].value;
    const draft: AppSettings["llm"] = {
      ...aiAssistLlmSettings,
      connectionMode: "cloud",
      cloudProvider: provider,
      cloudSelectedModel: aiAssistLlmSettings.cloudSelectedModelsByProvider[provider] ?? "",
    };
    const savedModels = draft.cloudEnabledModelsByProvider[provider] ?? [];
    setAdminCloudModels(savedModels.map((id) => ({ id, name: id, publisher: null })));
    setCloudProviderDraft(draft);
    setAiAssistNotice("");
    setAiAssistError("");
    setCloudProviderModalOpen(true);
  }

  function closeCloudProviderModal() {
    if (adminCloudModelsBusy || aiAssistPolicySaving) return;
    setCloudProviderModalOpen(false);
    setCloudProviderDraft(null);
    setAdminCloudModels([]);
  }

  function updateCloudProviderDraft(updater: (current: AppSettings["llm"]) => AppSettings["llm"]) {
    setCloudProviderDraft((current) => current ? updater(current) : current);
  }

  function handleAdminCloudLlmProviderChange(provider: CloudLlmProvider | "") {
    setAdminCloudModels([]);
    if (!provider) {
      updateCloudProviderDraft((current) => ({
        ...current,
        cloudApiSecret: "",
        cloudSelectedModel: "",
        cloudSelectedModelsByProvider: {
          ...current.cloudSelectedModelsByProvider,
          [current.cloudProvider]: "",
        },
      }));
      return;
    }
    updateCloudProviderDraft((current) => ({
      ...current,
      connectionMode: "cloud",
      cloudProvider: provider,
      cloudSelectedModel: current.cloudSelectedModelsByProvider[provider] ?? "",
    }));
  }

  async function saveCloudProviderDraft() {
    if (!cloudProviderDraft) return;
    await persistAiAssistLlmSettings({
      ...cloudProviderDraft,
      connectionMode: "cloud",
    }, "Cloud provider saved.");
    setCloudProviderModalOpen(false);
    setCloudProviderDraft(null);
    setAdminCloudModels([]);
  }

  async function removeCloudProvider() {
    if (!aiAssistLlmSettings) return;
    const defaults = DEFAULT_APP_SETTINGS.llm;
    await persistAiAssistLlmSettings({
      ...aiAssistLlmSettings,
      connectionMode: aiAssistLlmSettings.connectionMode === "cloud" ? "none" : aiAssistLlmSettings.connectionMode,
      cloudProvider: defaults.cloudProvider,
      cloudApiSecret: "",
      cloudSelectedModel: "",
      cloudSelectedModelsByProvider: {},
      cloudEnabledModelsByProvider: {},
    }, "Cloud provider removed.");
    setCloudProviderMenu(null);
    setCloudProviderModalOpen(false);
    setCloudProviderDraft(null);
    setAdminCloudModels([]);
  }

  async function handleAdminTestLocalLlmProvider() {
    if (!localProviderDraft) return;
    if (!localProviderDraft.ollamaHost.trim() || localProviderDraft.ollamaPort <= 0) {
      setAiAssistError("Enter a host and port before testing the local provider.");
      setAiAssistNotice("");
      return;
    }
    setAdminLocalModelsBusy(true);
    setAiAssistNotice("");
    setAiAssistError("");
    try {
      const result = await invoke<OllamaDiscoveryResult>("discover_ollama_models", {
        request: {
          localProvider: localProviderDraft.localProvider,
          protocol: localProviderDraft.ollamaProtocol,
          host: localProviderDraft.ollamaHost,
          port: localProviderDraft.ollamaPort,
          timeoutSeconds: localProviderDraft.ollamaRequestTimeoutSeconds,
        },
      });
      setAdminLocalModels(result.models);
      setLocalProviderDraft((current) => current
        ? {
            ...current,
            localEnabledModelsByProvider: {
              ...current.localEnabledModelsByProvider,
              [current.localProvider]: result.models.map((model) => model.name),
            },
          }
        : current);
      setAiAssistNotice(result.message);
    } catch (testError) {
      setAdminLocalModels([]);
      setAiAssistError(describeUnknownError(testError));
    } finally {
      setAdminLocalModelsBusy(false);
    }
  }

  async function handleAdminTestCloudLlmProvider() {
    if (!cloudProviderDraft) return;
    if (!cloudProviderDraft.cloudApiSecret.trim()) {
      setAiAssistError("Enter an API secret before testing the cloud provider.");
      setAiAssistNotice("");
      return;
    }
    setAdminCloudModelsBusy(true);
    setAiAssistNotice("");
    setAiAssistError("");
    try {
      const result = await invoke<CloudLlmDiscoveryResult>("discover_cloud_llm_models", {
        request: {
          provider: cloudProviderDraft.cloudProvider,
          apiSecret: cloudProviderDraft.cloudApiSecret,
          timeoutSeconds: cloudProviderDraft.ollamaRequestTimeoutSeconds,
        },
      });
      setAdminCloudModels(result.models);
      setCloudProviderDraft((current) => current
        ? {
            ...current,
            cloudEnabledModelsByProvider: {
              ...current.cloudEnabledModelsByProvider,
              [current.cloudProvider]: result.models.map((model) => model.id),
            },
          }
        : current);
      setAiAssistNotice(result.message);
    } catch (testError) {
      setAdminCloudModels([]);
      setAiAssistError(describeUnknownError(testError));
    } finally {
      setAdminCloudModelsBusy(false);
    }
  }

  function handleAdminLocalModelToggle(modelName: string, enabled: boolean) {
    updateLocalProviderDraft((current) => {
      const discoveredModelNames = adminLocalModels.map((model) => model.name);
      const currentEnabled = current.localEnabledModelsByProvider[current.localProvider] ?? discoveredModelNames;
      const nextEnabled = enabled
        ? Array.from(new Set([...currentEnabled, modelName]))
        : currentEnabled.filter((model) => model !== modelName);
      return {
        ...current,
        ollamaSelectedModel: nextEnabled.includes(current.ollamaSelectedModel) ? current.ollamaSelectedModel : "",
        localSelectedModelsByProvider: {
          ...current.localSelectedModelsByProvider,
          [current.localProvider]: nextEnabled.includes(current.localSelectedModelsByProvider[current.localProvider] ?? "")
            ? current.localSelectedModelsByProvider[current.localProvider] ?? ""
            : "",
        },
        localEnabledModelsByProvider: {
          ...current.localEnabledModelsByProvider,
          [current.localProvider]: nextEnabled,
        },
      };
    });
  }

  function handleAdminCloudModelToggle(modelId: string, enabled: boolean) {
    updateCloudProviderDraft((current) => {
      const discoveredModelIds = adminCloudModels.map((model) => model.id);
      const currentEnabled = current.cloudEnabledModelsByProvider[current.cloudProvider] ?? discoveredModelIds;
      const nextEnabled = enabled
        ? Array.from(new Set([...currentEnabled, modelId]))
        : currentEnabled.filter((model) => model !== modelId);
      return {
        ...current,
        cloudSelectedModel: nextEnabled.includes(current.cloudSelectedModel) ? current.cloudSelectedModel : "",
        cloudSelectedModelsByProvider: {
          ...current.cloudSelectedModelsByProvider,
          [current.cloudProvider]: nextEnabled.includes(current.cloudSelectedModelsByProvider[current.cloudProvider] ?? "")
            ? current.cloudSelectedModelsByProvider[current.cloudProvider] ?? ""
            : "",
        },
        cloudEnabledModelsByProvider: {
          ...current.cloudEnabledModelsByProvider,
          [current.cloudProvider]: nextEnabled,
        },
      };
    });
  }

  const refreshEmbeddingModelDetails = useCallback(async () => {
    const [nextStatus, nextDownloadStatus] = await Promise.all([
      getPostgresEmbeddingModelStatus(),
      getPostgresEmbeddingModelDownloadStatus(),
    ]);
    setEmbeddingModelStatus(nextStatus);
    setEmbeddingModelDownloadStatus(nextDownloadStatus);
  }, []);

  function closeAiAssistModal() {
    setActiveModal(null);
    setActiveEmbeddingModelModal(null);
    setAiAssistNotice("");
    setAiAssistError("");
  }

  function aiAssistAllowedForProject(projectId: string): boolean {
    if (!installationSettings) return true;
    if (installationSettings.aiAssistPolicy.mode === "disabled") return false;
    if (installationSettings.aiAssistPolicy.mode === "enabled") return true;
    return installationSettings.aiAssistPolicy.projectOverrides[projectId] ?? true;
  }

  function handleDownloadEmbeddingModel() {
    if (embeddingDownloadBusy) return;
    setEmbeddingModelSubmitting("download");
    setAiAssistNotice("");
    setAiAssistError("");
    const pendingStatus: PostgresEmbeddingModelDownloadStatus = {
      phase: "downloading",
      downloadedBytes: 0,
      totalBytes: null,
      downloadedFiles: 0,
      totalFiles: 0,
      currentFile: null,
      progressPercent: null,
      message: "Preparing download...",
    };
    setEmbeddingModelDownloadStatus(pendingStatus);
    notifyEmbeddingModelDownloadChanged({ status: pendingStatus, retry: { kind: "default" } });
    void downloadPostgresEmbeddingModel()
      .then((status) => {
        setEmbeddingModelStatus(status);
      })
      .catch((downloadError) => {
        notifyEmbeddingModelDownloadChanged({
          status: {
            ...pendingStatus,
            phase: "error",
            message: describeUnknownError(downloadError),
          },
          retry: { kind: "default" },
        });
      })
      .finally(() => {
        setEmbeddingModelSubmitting(null);
        void refreshEmbeddingModelDetails();
      });
  }

  function handleRetryCustomEmbeddingModel(modelUrl: string) {
    const trimmedModelUrl = modelUrl.trim();
    if (!trimmedModelUrl || embeddingDownloadBusy) return;
    setEmbeddingModelSubmitting("custom-download");
    setAiAssistNotice("");
    setAiAssistError("");
    const pendingStatus: PostgresEmbeddingModelDownloadStatus = {
      phase: "downloading",
      downloadedBytes: embeddingModelStatus?.bytes ?? 0,
      totalBytes: null,
      downloadedFiles: embeddingModelStatus?.files ?? 0,
      totalFiles: 0,
      currentFile: null,
      progressPercent: null,
      message: `Preparing download from ${trimmedModelUrl}...`,
    };
    setEmbeddingModelDownloadStatus(pendingStatus);
    notifyEmbeddingModelDownloadChanged({ status: pendingStatus, retry: { kind: "custom", modelUrl: trimmedModelUrl } });
    void downloadPostgresCustomEmbeddingModel(trimmedModelUrl)
      .then((status) => {
        setEmbeddingModelStatus(status);
      })
      .catch((downloadError) => {
        notifyEmbeddingModelDownloadChanged({
          status: {
            ...pendingStatus,
            phase: "error",
            message: describeUnknownError(downloadError),
          },
          retry: { kind: "custom", modelUrl: trimmedModelUrl },
        });
      })
      .finally(() => {
        setEmbeddingModelSubmitting(null);
        void refreshEmbeddingModelDetails();
      });
  }

  function handleDownloadCustomEmbeddingModel() {
    const modelUrl = customEmbeddingModelUrl.trim();
    if (!modelUrl || embeddingDownloadBusy) {
      if (!modelUrl) setAiAssistError("Enter a Hugging Face model URL or repository id.");
      return;
    }
    setEmbeddingModelSubmitting("custom-download");
    setAiAssistNotice("");
    setAiAssistError("");
    setActiveEmbeddingModelModal(null);
    const pendingStatus: PostgresEmbeddingModelDownloadStatus = {
      phase: "downloading",
      downloadedBytes: 0,
      totalBytes: null,
      downloadedFiles: 0,
      totalFiles: 0,
      currentFile: null,
      progressPercent: null,
      message: `Preparing download from ${modelUrl}...`,
    };
    setEmbeddingModelDownloadStatus(pendingStatus);
    notifyEmbeddingModelDownloadChanged({ status: pendingStatus, retry: { kind: "custom", modelUrl } });
    void downloadPostgresCustomEmbeddingModel(modelUrl)
      .then((status) => {
        setEmbeddingModelStatus(status);
      })
      .catch((downloadError) => {
        notifyEmbeddingModelDownloadChanged({
          status: {
            ...pendingStatus,
            phase: "error",
            message: describeUnknownError(downloadError),
          },
          retry: { kind: "custom", modelUrl },
        });
      })
      .finally(() => {
        setEmbeddingModelSubmitting(null);
        void refreshEmbeddingModelDetails();
      });
  }

  async function handleImportEmbeddingModelFolder(sourceDir?: string) {
    if (embeddingDownloadBusy) return;
    setEmbeddingModelSubmitting("import");
    setAiAssistNotice("");
    setAiAssistError("");
    try {
      const selected = sourceDir
        || await openDialog({
          directory: true,
          multiple: false,
          title: "Choose embedding model folder",
        });
      if (typeof selected !== "string") return;
      const status = await importPostgresEmbeddingModelFolder(selected);
      setEmbeddingModelStatus(status);
      setAiAssistNotice(`${status.displayName} imported.`);
      setCustomEmbeddingFolderPath("");
      setActiveEmbeddingModelModal(null);
      await refreshEmbeddingModelDetails();
    } catch (importError) {
      setAiAssistError(describeUnknownError(importError));
      await refreshEmbeddingModelDetails().catch(() => undefined);
    } finally {
      setEmbeddingModelSubmitting(null);
    }
  }

  async function handleClearEmbeddingModel() {
    if (embeddingDownloadBusy) return;
    setEmbeddingModelSubmitting("clear");
    setAiAssistNotice("");
    setAiAssistError("");
    try {
      const status = await clearPostgresEmbeddingModel();
      setEmbeddingModelStatus(status);
      setAiAssistNotice("Embedding model files cleared.");
      await refreshEmbeddingModelDetails();
    } catch (clearError) {
      setAiAssistError(describeUnknownError(clearError));
    } finally {
      setEmbeddingModelSubmitting(null);
    }
  }

  function handleEmbeddingFolderDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setAiAssistError("");
    const droppedFile = event.dataTransfer.files.item(0);
    const droppedPath = droppedFile
      ? (droppedFile as File & { path?: string }).path ?? ""
      : "";
    if (!droppedPath) {
      setAiAssistError("Drop a local embedding model folder, or use Choose Folder.");
      return;
    }
    setCustomEmbeddingFolderPath(droppedPath);
  }

  async function chooseCustomEmbeddingFolder() {
    setAiAssistError("");
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Choose embedding model folder",
    });
    if (typeof selected === "string") setCustomEmbeddingFolderPath(selected);
  }

  const persistUserPreferences = useCallback(async (
    next: PostgresUserPreferences,
    successMessage?: string,
  ) => {
    const saved = await savePostgresUserPreferences(next);
    setTheme(saved.theme);
    setDensity(saved.density);
    setFontSize(saved.fontSize);
    setSourceTextSizePx(saved.sourceTextSizePx);
    setRecentProjectLimit(saved.recentProjectLimit);
    applyPostgresRuntimeThemePreferences(saved);
    if (successMessage) setNotice(successMessage);
    setError("");
  }, []);

  const refreshPostgresDetails = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [
        nextStatus,
        nextBundledPostgresStatus,
        nextBundledPostgresPreflight,
        nextAuthStatus,
        nextProjects,
        nextAppUsers,
        nextInstallationSettings,
        nextUserPreferences,
      ] = await Promise.all([
        getPostgresStatus(),
        getBundledPostgresStatus(),
        getBundledPostgresInitPreflight(),
        getPostgresAuthStatus(),
        listPostgresProjects(),
        listPostgresAppUsers(),
        getPostgresInstallationSettings(),
        getPostgresUserPreferences(),
      ]);
      setStatus(nextStatus);
      setBundledPostgresStatus(nextBundledPostgresStatus);
      setBundledPostgresPreflight(nextBundledPostgresPreflight);
      setAuthStatus(nextAuthStatus);
      setProjects(nextProjects);
      setAppUsers(nextAppUsers);
      setInstallationSettings(nextInstallationSettings);
      syncLegacyAppSettingsFromPostgresInstallationSettings(nextInstallationSettings);
      setTheme(nextUserPreferences.theme);
      setDensity(nextUserPreferences.density);
      setFontSize(nextUserPreferences.fontSize);
      setSourceTextSizePx(nextUserPreferences.sourceTextSizePx);
      setRecentProjectLimit(nextUserPreferences.recentProjectLimit);
      applyPostgresRuntimeThemePreferences(nextUserPreferences);
      return { projects: nextProjects };
    } catch (loadError) {
      setError(describeUnknownError(loadError));
      return undefined;
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshAdminAuditLogs = useCallback(async () => {
    setAuditLoading(true);
    setAuditError("");
    try {
      const [nextAuthAuditEntries, nextProjectAuditEntries] = await Promise.all([
        listPostgresAdminAuthAuditLog(),
        listPostgresAdminProjectAuditLog(),
      ]);
      setAuthAuditEntries(nextAuthAuditEntries);
      setProjectAuditEntries(nextProjectAuditEntries);
    } catch (auditLoadError) {
      setAuditError(describeUnknownError(auditLoadError));
    } finally {
      setAuditLoading(false);
    }
  }, []);

  const refreshProjectMemberships = useCallback(async (sourceProjects: PostgresProject[] = projects) => {
    setLoadingProjectMemberships(true);
    setError("");
    try {
      const nextMemberships = await Promise.all(
        sourceProjects.map(async (project) => listPostgresProjectUsers(project.id)),
      );
      setProjectMemberships(nextMemberships.flat());
    } catch (membershipError) {
      setError(`Could not load PostgreSQL project memberships: ${describeUnknownError(membershipError)}`);
    } finally {
      setLoadingProjectMemberships(false);
    }
  }, [projects]);

  useEffect(() => {
    void refreshPostgresDetails();
  }, [refreshPostgresDetails]);

  useEffect(() => {
    if (!manageProjectMenu && !manageUserMenu && !localProviderMenu && !cloudProviderMenu) return;

    function closeMenu() {
      setManageProjectMenu(null);
      setManageUserMenu(null);
      setLocalProviderMenu(null);
      setCloudProviderMenu(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }

    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [manageProjectMenu, manageUserMenu, localProviderMenu, cloudProviderMenu]);

  useEffect(() => {
    if (activeModal === "manageUsers") {
      void refreshProjectMemberships();
    }
  }, [activeModal, refreshProjectMemberships]);

  useEffect(() => {
    if (activeModal === "administratorLog") {
      void refreshAdminAuditLogs();
    }
  }, [activeModal, refreshAdminAuditLogs]);

  useEffect(() => {
    if (activeModal === "updates") {
      void loadUpgradeBackupDiagnostics();
    }
  }, [activeModal, loadUpgradeBackupDiagnostics]);

  useEffect(() => {
    if (activeModal === "aiAssist" && aiAssistSetupDisabled && aiAssistAdminTab !== "usage") {
      setAiAssistAdminTab("usage");
    }
  }, [activeModal, aiAssistAdminTab, aiAssistSetupDisabled]);

  useEffect(() => {
    if (activeModal !== "aiAssist" || aiAssistAdminTab !== "embeddings") return;
    void refreshEmbeddingModelDetails().catch((modelError) => {
      setAiAssistError(describeUnknownError(modelError));
    });
  }, [activeModal, aiAssistAdminTab, refreshEmbeddingModelDetails]);

  useEffect(() => {
    if (activeModal !== "aiAssist" || !embeddingDownloadBusy) return;
    const timer = window.setInterval(() => {
      void refreshEmbeddingModelDetails().catch((modelError) => {
        setAiAssistError(describeUnknownError(modelError));
      });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [activeModal, embeddingDownloadBusy, refreshEmbeddingModelDetails]);

  useEffect(() => {
    if (activeModal !== "network" || status?.networkMode !== "internet") {
      setExternalIp({ status: "idle" });
      setInternetPing({ status: "idle" });
      return;
    }
    void refreshExternalIp();
  }, [activeModal, status?.networkMode]);

  const refreshStorageDetails = useCallback(async () => {
    try {
      const info = await getAppRuntimeInfo();
      const [databaseStats, backupStats] = await Promise.all([
        readDirectoryStats(joinFsPath(info.appDataDir, "postgres-projects")),
        readDirectoryStats(joinFsPath(info.appDataDir, "project_backups")),
      ]);
      setAppInfo(info);
      setStorageSummary({
        databaseBytes: databaseStats.bytes,
        databaseFiles: databaseStats.files,
        backupBytes: backupStats.bytes,
        backupFiles: backupStats.files,
      });
    } catch (storageError) {
      setError(`Could not load storage details: ${describeUnknownError(storageError)}`);
    }
  }, []);

  useEffect(() => {
    void refreshStorageDetails();
  }, [refreshStorageDetails]);

  async function handlePrepareBundledRuntimeDirs() {
    setLoading(true);
    setError("");
    setNotice("");
    setRuntimeNotice("");
    try {
      await prepareBundledPostgresRuntimeDirs();
      setNotice("Bundled PostgreSQL runtime folders prepared.");
      await refreshPostgresDetails();
      await refreshStorageDetails();
    } catch (prepareError) {
      setError(`Could not prepare bundled PostgreSQL runtime folders: ${describeUnknownError(prepareError)}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleStartBundledPostgresRuntime() {
    setLoading(true);
    setError("");
    setRuntimeNotice("");
    try {
      const result = await startBundledPostgresRuntime();
      setRuntimeNotice(result.message);
      await refreshPostgresDetails();
    } catch (startError) {
      setError(`Could not start bundled PostgreSQL runtime: ${describeUnknownError(startError)}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleStopBundledPostgresRuntime() {
    setLoading(true);
    setError("");
    setRuntimeNotice("");
    try {
      const result = await stopBundledPostgresRuntime();
      setRuntimeNotice(result.message);
      await refreshPostgresDetails();
    } catch (stopError) {
      setError(`Could not stop bundled PostgreSQL runtime: ${describeUnknownError(stopError)}`);
    } finally {
      setLoading(false);
    }
  }

  function handleDensity(nextDensity: Density) {
    setDensity(nextDensity);
    applyDensity(nextDensity);
    void persistUserPreferences({
      theme,
      density: nextDensity,
      fontSize,
      sourceTextSizePx,
      locale,
      recentProjectLimit,
      themeState: getStoredThemeState(),
    });
  }

  function handleFontSize(nextFontSize: FontSize) {
    setFontSize(nextFontSize);
    applyFontSize(nextFontSize);
    void persistUserPreferences({
      theme,
      density,
      fontSize: nextFontSize,
      sourceTextSizePx,
      locale,
      recentProjectLimit,
      themeState: getStoredThemeState(),
    });
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

  async function testPostgresLanPing() {
    if (!status?.localIp) return;
    setLanPing({ status: "loading" });
    try {
      const ms = await invoke<number>("ping_address", { host: status.localIp, port: status.port });
      setLanPing({ status: "success", ms });
    } catch (pingError) {
      setLanPing({ status: "error", error: describeUnknownError(pingError) });
    }
  }

  async function testPostgresInternetPing() {
    if (!externalIp.value) return;
    setInternetPing({ status: "loading" });
    try {
      const ms = await invoke<number>("ping_address", { host: externalIp.value, port: status?.port ?? 5432 });
      setInternetPing({ status: "success", ms });
    } catch (pingError) {
      setInternetPing({ status: "error", error: describeUnknownError(pingError) });
    }
  }

  async function refreshExternalIp() {
    setExternalIp({ status: "loading" });
    try {
      const value = await invoke<string>("get_external_ip");
      setExternalIp({ status: "success", value });
    } catch (lookupError) {
      setExternalIp({ status: "error", error: describeUnknownError(lookupError) });
    }
  }

  function copyNetworkAddress(address: string) {
    void navigator.clipboard.writeText(address).then(
      () => {
        setCopiedNetworkAddress(address);
        window.setTimeout(() => {
          setCopiedNetworkAddress((current) => current === address ? "" : current);
        }, 1800);
      },
      () => {
        if (activeModal === "network") {
          setNetworkError("Could not copy the address to the clipboard.");
        } else {
          setError("Could not copy the address to the clipboard.");
        }
      },
    );
  }

  async function applyPostgresNetworkMode(mode: "device" | "network" | "internet") {
    if (networkSwitching || status?.networkMode === mode) return;
    setNetworkSwitching(true);
    setNetworkError("");
    setNetworkNotice("");
    try {
      const nextStatus = await Promise.race([
        setPostgresNetworkMode(mode),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => {
            reject(new Error("Timed out while saving PostgreSQL network settings."));
          }, 60000);
        }),
      ]);
      setStatus(nextStatus);
      setLanPing({ status: "idle" });
      setInternetPing({ status: "idle" });
      setNetworkNotice(
        mode === "device"
          ? "Device-only database mode restored."
          : mode === "network"
            ? "LAN collaboration mode enabled."
            : "Internet database access mode enabled.",
      );
    } catch (switchError) {
      setNetworkError(describeUnknownError(switchError));
    } finally {
      setNetworkSwitching(false);
    }
  }

  async function handlePostgresNetworkModeToggle(mode: "device" | "network" | "internet") {
    if (networkSwitching || status?.networkMode === mode) return;
    if (mode === "internet" || (mode === "network" && status?.networkMode === "device")) {
      setPendingNetworkMode(mode);
      setInternetModeConfirmation("");
      setConfirmEnableNetworkMode(true);
      return;
    }
    await applyPostgresNetworkMode(mode);
  }

  async function handleConfirmPostgresNetworkMode() {
    setConfirmEnableNetworkMode(false);
    setInternetModeConfirmation("");
    await applyPostgresNetworkMode(pendingNetworkMode);
  }

  function resetAddUserModal() {
    setAddUserTab("account");
    setAddUserUsername("");
    setAddUserPassword("");
    setAddUserPasswordConfirm("");
    setAddUserPasswordVisible(false);
    setAddUserPasswordConfirmVisible(false);
    setAddUserProjectRoles({});
  }

  function resetAddProjectModal() {
    setAddProjectTab("details");
    setAddProjectName("");
    setAddProjectDescription("");
    setAddProjectUserRoles({});
  }

  function setAddUserProjectRole(projectId: string, role: string) {
    setAddUserProjectRoles((current) => {
      const next = { ...current };
      if (!role) {
        delete next[projectId];
      } else {
        next[projectId] = role;
      }
      return next;
    });
  }

  function setAddProjectUserRole(userId: string, role: string) {
    setAddProjectUserRoles((current) => {
      const next = { ...current };
      if (!role) {
        delete next[userId];
      } else {
        next[userId] = role;
      }
      return next;
    });
  }

  function closeMembershipModal() {
    setMembershipUser(null);
    setMembershipNotice("");
    setMembershipError("");
  }

  async function handleCreatePostgresProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authSession.authKind !== "postgres_admin") {
      setError("Sign in as the PostgreSQL administrator to create projects.");
      return;
    }
    const name = addProjectName.trim();
    if (!name) {
      setError("Enter a project name.");
      setAddProjectTab("details");
      return;
    }

    setCreatingProject(true);
    setError("");
    setNotice("");
    try {
      const created = await createPostgresProject({
        name,
        description: addProjectDescription.trim(),
      });
      const selectedUserRoles = Object.entries(addProjectUserRoles).filter(([, role]) => role);
      const createdMemberships: PostgresProjectUser[] = [];
      for (const [appUserId, role] of selectedUserRoles) {
        const user = appUsers.find((entry) => entry.id === appUserId);
        if (!user || user.id === authSession.user.id) continue;
        createdMemberships.push(await createPostgresProjectUser({
          projectId: created.id,
          appUserId,
          role,
        }));
      }
      setProjects((current) => [...current.filter((project) => project.id !== created.id), created]
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)));
      if (createdMemberships.length) {
        setProjectMemberships((current) => [
          ...current.filter((membership) => membership.projectId !== created.id),
          ...createdMemberships,
        ]);
      }
      setAuthStatus(await getPostgresAuthStatus());
      resetAddProjectModal();
      setActiveModal(null);
      setNotice(`Created project ${created.name}.`);
    } catch (createError) {
      setError(describeUnknownError(createError));
    } finally {
      setCreatingProject(false);
    }
  }

  async function handleOpenManagedProject(project: PostgresProject) {
    if (!project.active) {
      setError("Enable this project before opening it.");
      return;
    }
    setOpeningProjectId(project.id);
    setError("");
    setNotice("");
    try {
      await onOpenProject?.(project);
      setProjectAccessWarning(null);
      setActiveModal(null);
    } catch (openError) {
      setError(describeUnknownError(openError));
    } finally {
      setOpeningProjectId("");
    }
  }

  async function handleSetManagedProjectActive(project: PostgresProject, active: boolean) {
    if (authSession.authKind !== "postgres_admin") {
      setError("Sign in as the PostgreSQL administrator to manage project status.");
      return;
    }
    setUpdatingProjectStatusId(project.id);
    setError("");
    setNotice("");
    try {
      const updated = await setPostgresProjectActive(project.id, active);
      setProjects((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
      setProjectAccessWarning(null);
      setNotice(`${active ? "Enabled" : "Disabled"} project ${updated.name}.`);
    } catch (statusError) {
      setError(describeUnknownError(statusError));
    } finally {
      setUpdatingProjectStatusId("");
    }
  }

  async function handleDeleteManagedProject(project: PostgresProject) {
    if (authSession.authKind !== "postgres_admin") {
      setError("Sign in as the PostgreSQL administrator to delete projects.");
      return;
    }
    setDeletingProjectId(project.id);
    setError("");
    setNotice("");
    try {
      await deletePostgresProject(project.id);
      await removePostgresProjectFromState(project.id);
      setProjects((current) => current.filter((entry) => entry.id !== project.id));
      setProjectMemberships((current) => current.filter((entry) => entry.projectId !== project.id));
      setProjectAccessWarning(null);
      setNotice(`Deleted project ${project.name}.`);
    } catch (deleteError) {
      setError(describeUnknownError(deleteError));
    } finally {
      setDeletingProjectId("");
    }
  }

  async function handleCreatePostgresUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authSession.authKind !== "postgres_admin") {
      setError("Sign in as the PostgreSQL administrator to create users.");
      return;
    }
    const username = addUserUsername.trim().toLowerCase();
    if (!username) {
      setError("Enter a username.");
      setAddUserTab("account");
      return;
    }
    if (/\s/.test(username)) {
      setError("Usernames cannot contain spaces.");
      setAddUserTab("account");
      return;
    }
    if (addUserPassword.length < 8) {
      setError("Choose a password with at least 8 characters.");
      setAddUserTab("account");
      return;
    }
    if (addUserPassword !== addUserPasswordConfirm) {
      setError("The passwords do not match.");
      setAddUserTab("account");
      return;
    }
    const selectedProjectRoles = Object.entries(addUserProjectRoles).filter(([, role]) => role);
    if (!selectedProjectRoles.length) {
      setError("Choose at least one project for this user.");
      setAddUserTab("projects");
      return;
    }

    setCreatingUser(true);
    setError("");
    setNotice("");
    try {
      const created = await createPostgresAppUser({
        name: username,
        username,
        password: addUserPassword,
        mustChangePassword: true,
      });
      for (const [projectId, role] of selectedProjectRoles) {
        await createPostgresProjectUser({
          projectId,
          appUserId: created.id,
          role,
        });
      }
      setAppUsers((current) => [...current.filter((user) => user.id !== created.id), created]
        .sort((a, b) => a.name.localeCompare(b.name) || a.username.localeCompare(b.username)));
      setAuthStatus(await getPostgresAuthStatus());
      await refreshPostgresDetails();
      resetAddUserModal();
      setActiveModal(null);
      setNotice(`Created PostgreSQL app user ${created.username}. They will be asked to change their password on first login.`);
    } catch (createError) {
      setError(describeUnknownError(createError));
    } finally {
      setCreatingUser(false);
    }
  }

  async function handleDeactivatePostgresUser(user: PostgresAppUser) {
    if (authSession.authKind !== "postgres_admin") {
      setError("Sign in as the PostgreSQL administrator to deactivate users.");
      return;
    }
    if (!user.active) return;

    setDeactivatingUserId(user.id);
    setError("");
    setNotice("");
    try {
      const deactivated = await deactivatePostgresAppUser(user.id);
      setAppUsers((current) => current.map((entry) => entry.id === deactivated.id ? deactivated : entry));
      setAuthStatus(await getPostgresAuthStatus());
      setUserAccessWarning(null);
      setNotice(`Disabled ${deactivated.username}.`);
    } catch (deactivateError) {
      setError(describeUnknownError(deactivateError));
    } finally {
      setDeactivatingUserId("");
    }
  }

  async function handleReactivatePostgresUser(user: PostgresAppUser) {
    if (authSession.authKind !== "postgres_admin") {
      setError("Sign in as the PostgreSQL administrator to enable users.");
      return;
    }
    if (user.active) return;

    setError("");
    setNotice("");
    setUserAccessWarning(null);
    setResetPasswordUser(user);
    setResetPasswordValue("");
    setResetPasswordConfirmValue("");
    setResetPasswordVisible(false);
    setResetPasswordConfirmVisible(false);
    setRequiredResetUserId(user.id);
  }

  async function handleUpdateProjectMembershipRole(membership: PostgresProjectUser, role: string) {
    if (authSession.authKind !== "postgres_admin") {
      setMembershipError("Sign in as the PostgreSQL administrator to change project roles.");
      return;
    }
    if (!role || role === membership.role) return;

    setUpdatingMembershipId(membership.id);
    setMembershipError("");
    setMembershipNotice("");
    try {
      const updated = await updatePostgresProjectUser({
        projectId: membership.projectId,
        projectUserId: membership.id,
        role,
      });
      setProjectMemberships((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
      setMembershipNotice(`Updated ${updated.email}'s role for ${projectById.get(updated.projectId)?.name ?? "project"}.`);
    } catch (updateError) {
      setMembershipError(describeUnknownError(updateError));
    } finally {
      setUpdatingMembershipId("");
    }
  }

  async function handleAddProjectMembership(user: PostgresAppUser, project: PostgresProject) {
    if (authSession.authKind !== "postgres_admin") {
      setMembershipError("Sign in as the PostgreSQL administrator to add project access.");
      return;
    }
    if ((membershipsByAppUserId[user.id] ?? []).some((membership) => membership.projectId === project.id)) {
      return;
    }

    setAddingMembershipProjectId(project.id);
    setMembershipError("");
    setMembershipNotice("");
    try {
      const created = await createPostgresProjectUser({
        projectId: project.id,
        appUserId: user.id,
        role: "viewer",
      });
      setProjectMemberships((current) => [
        ...current.filter((entry) => entry.id !== created.id),
        created,
      ]);
      setMembershipNotice(`Added ${created.email} to ${project.name}.`);
    } catch (addError) {
      setMembershipError(describeUnknownError(addError));
    } finally {
      setAddingMembershipProjectId("");
    }
  }

  async function handleRemoveProjectMembership(membership: PostgresProjectUser) {
    if (authSession.authKind !== "postgres_admin") {
      setMembershipError("Sign in as the PostgreSQL administrator to remove project access.");
      return;
    }
    setMembershipError("");
    setMembershipNotice("");
    setMembershipRemovalWarning(membership);
  }

  async function confirmRemoveProjectMembership(membership: PostgresProjectUser) {
    if (authSession.authKind !== "postgres_admin") {
      setMembershipError("Sign in as the PostgreSQL administrator to remove project access.");
      return;
    }
    const project = projectById.get(membership.projectId);

    setRemovingMembershipId(membership.id);
    setMembershipError("");
    setMembershipNotice("");
    try {
      await deletePostgresProjectUser(membership.projectId, membership.id);
      setProjectMemberships((current) => current.filter((entry) => entry.id !== membership.id));
      setMembershipRemovalWarning(null);
      setMembershipNotice(`Removed ${membership.email}'s access to ${project?.name ?? "project"}.`);
    } catch (removeError) {
      setMembershipError(describeUnknownError(removeError));
    } finally {
      setRemovingMembershipId("");
    }
  }

  async function handleResetPostgresUserPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetPasswordUser) return;
    if (authSession.authKind !== "postgres_admin") {
      setError("Sign in as the PostgreSQL administrator to reset user passwords.");
      return;
    }
    if (resetPasswordValue.length < 8) {
      setError("Choose a password with at least 8 characters.");
      return;
    }
    if (resetPasswordValue !== resetPasswordConfirmValue) {
      setError("The password entries do not match.");
      return;
    }

    const wasLoginBlocked = postgresUserIsLoginBlocked(resetPasswordUser);
    setResettingPassword(true);
    setError("");
    setNotice("");
    try {
      const updated = await resetPostgresAppUserPassword({
        userId: resetPasswordUser.id,
        newPassword: resetPasswordValue,
      });
      let finalUser = updated;
      if (requiredResetUserId === resetPasswordUser.id && !updated.active) {
        setReactivatingUserId(updated.id);
        finalUser = await reactivatePostgresAppUser(updated.id);
        setAuthStatus(await getPostgresAuthStatus());
      }
      setAppUsers((current) => current.map((entry) => entry.id === finalUser.id ? finalUser : entry));
      setResetPasswordUser(null);
      setResetPasswordValue("");
      setResetPasswordConfirmValue("");
      setResetPasswordVisible(false);
      setResetPasswordConfirmVisible(false);
      setRequiredResetUserId("");
      setNotice(
        wasLoginBlocked
          ? `Reset password and removed login block for ${finalUser.username}.`
          : finalUser.active && requiredResetUserId === resetPasswordUser.id
          ? `Enabled ${finalUser.username}. They will be asked to change their password on first login.`
          : `Reset password for ${finalUser.username}.`,
      );
    } catch (resetError) {
      setError(describeUnknownError(resetError));
    } finally {
      setResettingPassword(false);
      setReactivatingUserId("");
    }
  }

  return (
    <div className="view app-settings-view app-settings-view--admin">
      <header className="view-header">
        <div className="users-header-title-wrap">
          <h1>Administrator Settings</h1>
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

      {notice ? <p className="settings-success">{notice}</p> : null}
      {error ? <p className="auth-error">{error}</p> : null}

      {helpOpen ? (
        <SettingsModal title="App Settings Help" onClose={() => setHelpOpen(false)} modalClassName="modal--help">
          <div className="app-settings-modal-body">
            <p className="users-guide-copy">
              Manage language, appearance, AI runtime defaults, updates, storage, and PostgreSQL administration.
            </p>
            <p className="users-guide-copy">
              PostgreSQL-backed settings are shared through the local installation database. Appearance and recent-project display preferences are stored per signed-in app user.
            </p>
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
            <button type="button" className="btn btn--primary" onClick={() => setHelpOpen(false)}>
              Close
            </button>
          </div>
        </SettingsModal>
      ) : null}

      <div className="app-settings-overview-shell">
        <div className="app-settings-overview-stack app-settings-overview-stack--admin">
          <div className="app-settings-overview-sections">
            {appSettingsSections.map((section) => (
              <section key={section.id} className="app-settings-overview-section app-settings-overview-section--compact">
                <div className="app-settings-overview-section-header">
                  <p className="app-settings-overview-section-heading">{section.sectionHeading}</p>
                </div>
                <div className="app-settings-overview-grid app-settings-overview-grid--compact">
                  {section.cards.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      className={`app-settings-overview-card app-settings-overview-card--compact app-settings-overview-card--${card.tone}`}
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

      {onSignOut ? (
        <button
          type="button"
          className="admin-signout-button"
          aria-label="Sign out"
          title="Sign out"
          onClick={() => void onSignOut()}
        >
          <LogoutIcon className="admin-signout-icon" />
        </button>
      ) : null}

      {activeModal === "language" ? (
        <LanguageSettingsModal
          title={t("appSettings.sectionTitles.language")}
          label={t("appSettings.language.label")}
          locale={locale}
          onChange={(nextLocale) => {
            setLocale(nextLocale);
            void persistUserPreferences({
              theme,
              density,
              fontSize,
              sourceTextSizePx,
              locale: nextLocale,
              recentProjectLimit,
              themeState: getStoredThemeState(),
            }, t("appSettings.language.saved"));
          }}
          onClose={() => {
            setActiveModal(null);
            setNetworkNotice("");
            setNetworkError("");
          }}
        />
      ) : null}

      {activeModal === "appearance" ? (
        <SettingsModal title="Appearance" onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              {membershipNotice ? <p className="settings-success">{membershipNotice}</p> : null}
              {membershipError ? <p className="auth-error">{membershipError}</p> : null}
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default"><h3>Interface</h3></div>
                  <div className="app-settings-modal-section-body">
                    <ActiveThemePreviewRow theme={theme} onEdit={() => setShowThemeManager(true)} />
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <div className="settings-row-label">Interface density</div>
                        <div className="settings-row-desc">Choose a more spacious or compact layout.</div>
                      </div>
                      <div className="segmented-control">
                        {(["comfortable", "compact"] as Density[]).map((option) => (
                          <button
                            key={option}
                            type="button"
                            className={density === option ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                            onClick={() => handleDensity(option)}
                          >
                            {option === "comfortable" ? "Comfortable" : "Compact"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <div className="settings-row-label">Text size</div>
                        <div className="settings-row-desc">Adjust default interface text size.</div>
                      </div>
                      <div className="segmented-control">
                        {(["small", "normal", "large"] as FontSize[]).map((option) => (
                          <button
                            key={option}
                            type="button"
                            className={fontSize === option ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                            onClick={() => handleFontSize(option)}
                          >
                            {option === "small" ? "Small" : option === "normal" ? "Normal" : "Large"}
                          </button>
                        ))}
                      </div>
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

      {activeModal === "storage" ? (
        <SettingsModal title={t("appSettings.storage.localStorageTitle")} onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <SettingsModalSection title={t("appSettings.storage.localStorageTitle")}>
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
                    {appInfo?.appDataDir ? (
                      <button
                        className="btn"
                        type="button"
                        onClick={() => void navigator.clipboard.writeText(appInfo.appDataDir)}
                      >
                        {t("appSettings.storage.copyPath")}
                      </button>
                    ) : null}
                  </div>

                  <div className="app-settings-stats">
                    <div className="app-settings-stat-card">
                      <strong>{t("appSettings.storage.database")}</strong>
                      <span>{formatBytes(storageSummary.databaseBytes)}</span>
                      <small>{formatStorageFileSummary(storageSummary.databaseFiles, "postgres-projects")}</small>
                    </div>
                    <div className="app-settings-stat-card">
                      <strong>{t("appSettings.storage.backups")}</strong>
                      <span>{formatBytes(storageSummary.backupBytes)}</span>
                      <small>{formatStorageFileSummary(storageSummary.backupFiles, "project_backups")}</small>
                    </div>
                    <div className="app-settings-stat-card">
                      <strong>{t("appSettings.storage.totalTrackedStorage")}</strong>
                      <span>{formatBytes(storageSummary.databaseBytes + storageSummary.backupBytes)}</span>
                      <small>{t("appSettings.storage.totalTrackedStorageDescription")}</small>
                    </div>
                  </div>
                </SettingsModalSection>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button>
            </div>
        </SettingsModal>
      ) : null}

      {activeModal === "network" ? (
        <SettingsModal
          title={t("appSettings.sectionTitles.network")}
          onClose={() => {
            setActiveModal(null);
            setNetworkNotice("");
            setNetworkError("");
          }}
        >
            <div className="app-settings-modal-body">
              {networkNotice ? <p className="settings-success">{networkNotice}</p> : null}
              {networkError ? <p className="auth-error">{networkError}</p> : null}
              {networkSwitching ? (
                <div className="app-settings-modal-loading">
                  <LoadingCard />
                </div>
              ) : (
              <div className="app-settings-modal-sections">
                <SettingsModalSection title={t("appSettings.network.accessModeTitle")}>
                  <div className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-label">{t("appSettings.network.networkMode")}</div>
                    </div>
                    <div className="segmented-control">
                      {(["device", "network", "internet"] as const).map((option) => (
                        <button
                          key={option}
                          type="button"
                          className={status?.networkMode === option ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                          onClick={() => void handlePostgresNetworkModeToggle(option)}
                          disabled={networkSwitching || !status}
                        >
                          {option === "device"
                            ? "Device"
                            : option === "network"
                              ? "LAN"
                              : "Internet"}
                        </button>
                      ))}
                    </div>
                  </div>
                  {status?.networkMode === "internet" ? (
                    <div className="settings-warning settings-warning--danger">
                      <strong>Internet mode is live.</strong>
                      <br />
                      KanQual is accepting database connections from the public Internet. KanQual does not manage TLS certificates for this mode, so traffic may be readable unless you protect access with a VPN, encrypted tunnel, firewall, or equivalent network security.
                    </div>
                  ) : status?.networkMode === "network" ? (
                    <div className="settings-warning settings-warning--danger">
                      <strong>LAN mode is live.</strong>
                      <br />
                      Other devices on the same trusted network may connect to this PostgreSQL database until you switch back to Device mode.
                    </div>
                  ) : (
                    <div className="settings-warning">
                      <strong>Device mode is the default.</strong>
                      <br />
                      KanQual will revert to Device mode every time it starts. Remote users cannot connect while Device mode is active.
                    </div>
                  )}
                </SettingsModalSection>

                <SettingsModalSection title={t("appSettings.network.connectionAddressesTitle")}>
                  <PostgresNetworkAddressCard
                    label="LAN"
                    host={status?.localIp ?? null}
                    port={status?.port ?? 5432}
                    loading={Boolean(status && !status.localIp)}
                    mode="network"
                    statusText={status?.networkMode === "network" ? "Active" : status?.networkMode === "internet" ? "Available through Internet mode" : "Enable LAN or Internet"}
                    copied={Boolean(status?.localIp && copiedNetworkAddress === `${status.localIp}:${status.port}`)}
                    ping={lanPing}
                    disabled={!status || status.networkMode === "device"}
                    copyDisabled={status?.networkMode === "device"}
                    testDisabledReason={status?.networkMode === "device" ? "Enable LAN or Internet mode before testing this address." : undefined}
                    onCopy={copyNetworkAddress}
                    onTest={testPostgresLanPing}
                    successText="Network database reachable"
                    errorText="Network database unreachable"
                  />
                  <PostgresNetworkAddressCard
                    label="Internet"
                    host={externalIp.value ?? null}
                    port={status?.port ?? 5432}
                    loading={status?.networkMode === "internet" && externalIp.status === "loading"}
                    mode="internet"
                    statusText={status?.networkMode === "internet" ? "Active" : "Enable Internet"}
                    copied={Boolean(externalIp.value && copiedNetworkAddress === `${externalIp.value}:${status?.port ?? 5432}`)}
                    ping={internetPing}
                    disabled={!status || status.networkMode !== "internet" || externalIp.status !== "success"}
                    copyDisabled={status?.networkMode !== "internet" || externalIp.status !== "success"}
                    testDisabledReason={
                      status?.networkMode !== "internet"
                        ? "Enable Internet mode before testing this endpoint."
                        : externalIp.status === "error"
                          ? externalIp.error
                          : "Public reachability depends on external routing, firewall, VPN, or tunnel settings."
                    }
                    onCopy={copyNetworkAddress}
                    onTest={testPostgresInternetPing}
                    successText="Public database endpoint reachable"
                    errorText="Database unreachable"
                  />
                  {status?.networkMode === "internet" ? (
                    <div className="settings-warning settings-warning--danger">
                      This is the public IP address and port for your KanQual server. Other security settings like routing, firewall, VPN, or encrypted tunnels may be necessary for others to reach it safely.
                    </div>
                  ) : null}
                </SettingsModalSection>
              </div>
              )}
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  setActiveModal(null);
                  setNetworkNotice("");
                  setNetworkError("");
                }}
              >
                Done
              </button>
            </div>
        </SettingsModal>
      ) : null}

      {activeModal === "aiAssist" ? (
        <>
          <SettingsModal title="AI Assist" onClose={closeAiAssistModal}>
            <div className="app-settings-modal-body">
              {aiAssistNotice ? <p className="settings-success">{aiAssistNotice}</p> : null}
              {aiAssistError ? <p className="auth-error">{aiAssistError}</p> : null}
              <div className="ai-assist-home-tabbar" style={{ marginBottom: 16 }}>
                <div className="segmented-control" role="tablist" aria-label="AI Assist administrator settings">
                  <button
                    type="button"
                    className={aiAssistAdminTab === "usage" ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                    onClick={() => setAiAssistAdminTab("usage")}
                  >
                    Usage
                  </button>
                  <button
                    type="button"
                    className={aiAssistAdminTab === "embeddings" ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                    disabled={aiAssistSetupDisabled}
                    onClick={() => setAiAssistAdminTab("embeddings")}
                    title={aiAssistSetupDisabled ? "Enable AI Assist usage before configuring embeddings." : undefined}
                  >
                    Embeddings
                  </button>
                  <button
                    type="button"
                    className={aiAssistAdminTab === "llms" ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                    disabled={aiAssistSetupDisabled}
                    onClick={() => setAiAssistAdminTab("llms")}
                    title={aiAssistSetupDisabled ? "Enable AI Assist usage before configuring LLMs." : undefined}
                  >
                    LLMs
                  </button>
                </div>
              </div>

              {aiAssistAdminTab === "usage" ? (
                <div className="app-settings-modal-sections">
                  <SettingsModalSection title="Availability">
                    <div className="settings-toggle-row">
                      <span className="settings-row-label">AI Assist access</span>
                      <div className="segmented-control" role="tablist" aria-label="AI Assist access" style={{ width: "fit-content" }}>
                        {[
                          { mode: "disabled", label: "Disabled", message: "AI Assist disabled for this server." },
                          { mode: "project", label: "Selective", message: "AI Assist will use project-specific availability." },
                          { mode: "enabled", label: "Enabled", message: "AI Assist enabled for every project." },
                        ].map((option) => (
                          <button
                            key={option.mode}
                            type="button"
                            className={aiAssistPolicyMode === option.mode ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                            disabled={!installationSettings || aiAssistPolicySaving}
                            onClick={() => {
                              if (!installationSettings || aiAssistPolicyMode === option.mode) return;
                              const mode = option.mode as PostgresInstallationSettings["aiAssistPolicy"]["mode"];
                              void persistAiAssistPolicy(
                                {
                                  ...installationSettings.aiAssistPolicy,
                                  mode,
                                  serverEnabled: mode !== "disabled",
                                },
                                option.message,
                              );
                            }}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </SettingsModalSection>

                  {aiAssistPolicyMode === "project" ? (
                    <SettingsModalSection title="Projects">
                      <div className="users-table-wrap postgres-users-table-wrap" style={{ maxHeight: 360 }}>
                        <table className="users-table" style={{ tableLayout: "auto", width: "100%" }}>
                          <thead>
                            <tr>
                              <th className="users-th">Project</th>
                              <th className="users-th" style={{ width: 220, whiteSpace: "nowrap" }}>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {projects.length === 0 ? (
                              <tr>
                                <td className="users-td users-td--muted" colSpan={2}>No projects yet</td>
                              </tr>
                            ) : projects.map((project) => {
                              const allowed = aiAssistAllowedForProject(project.id);
                              return (
                                <tr key={project.id} className="users-row">
                                  <td className="users-td users-td--name">{project.name}</td>
                                  <td className="users-td" style={{ width: 220, whiteSpace: "nowrap" }}>
                                    <div className="segmented-control" role="tablist" aria-label={`AI Assist status for ${project.name}`} style={{ width: "fit-content" }}>
                                      {[
                                        { value: false, label: "Disabled", message: `AI Assist disallowed for ${project.name}.` },
                                        { value: true, label: "Enabled", message: `AI Assist allowed for ${project.name}.` },
                                      ].map((option) => (
                                        <button
                                          key={option.label}
                                          type="button"
                                          className={allowed === option.value ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                                          disabled={!installationSettings || aiAssistPolicySaving}
                                          onClick={() => {
                                            if (!installationSettings || allowed === option.value) return;
                                            void persistAiAssistPolicy(
                                              {
                                                ...installationSettings.aiAssistPolicy,
                                                mode: "project",
                                                serverEnabled: true,
                                                projectOverrides: {
                                                  ...installationSettings.aiAssistPolicy.projectOverrides,
                                                  [project.id]: option.value,
                                                },
                                              },
                                              option.message,
                                            );
                                          }}
                                        >
                                          {option.label}
                                        </button>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </SettingsModalSection>
                  ) : null}
                </div>
              ) : aiAssistAdminTab === "embeddings" ? (
                <div className="app-settings-modal-sections">
                  <SettingsModalSection title="Select Model">
                    <select className="form-input" value={hasEmbeddingModel ? embeddingModelStatus?.repoId ?? "" : ""} disabled={!hasEmbeddingModel}>
                      {hasEmbeddingModel ? (
                        <option value={embeddingModelStatus?.repoId ?? ""}>
                          {embeddingModelStatus?.displayName ?? "Downloaded embedding model"}
                        </option>
                      ) : (
                        <option value="">No downloaded embedding models</option>
                      )}
                    </select>
                  </SettingsModalSection>

                  <SettingsModalSection title="Default Model">
                    <div className="settings-toggle-row">
                      <div className="settings-row-info">
                        <div className="settings-row-label">multilingual-e5-large</div>
                        <div className="settings-row-desc">This is the default embedding model.</div>
                        <a
                          className="settings-inline-link"
                          href="https://huggingface.co/intfloat/multilingual-e5-large"
                          target="_blank"
                          rel="noreferrer"
                        >
                          https://huggingface.co/intfloat/multilingual-e5-large
                        </a>
                      </div>
                      {!hasEmbeddingModel && !partialEmbeddingModelIsDefault && !embeddingDownloadBusy ? (
                        <button
                          className="btn btn--primary"
                          type="button"
                          onClick={() => void handleDownloadEmbeddingModel()}
                          disabled={embeddingModelSubmitting === "download"}
                          style={{ marginLeft: "auto" }}
                        >
                          {embeddingModelSubmitting === "download" ? "Starting..." : "Download"}
                        </button>
                      ) : null}
                      {partialEmbeddingModelIsDefault && !embeddingDownloadBusy ? (
                        <div className="project-export-actions project-export-actions--modal" style={{ marginLeft: "auto" }}>
                          <button
                            className="btn"
                            type="button"
                            onClick={() => void handleClearEmbeddingModel()}
                            disabled={embeddingModelSubmitting === "clear"}
                          >
                            {embeddingModelSubmitting === "clear" ? "Clearing..." : "Clear"}
                          </button>
                          <button
                            className="btn btn--primary"
                            type="button"
                            onClick={() => void handleDownloadEmbeddingModel()}
                            disabled={embeddingModelSubmitting === "download"}
                          >
                            {embeddingModelSubmitting === "download" ? "Starting..." : "Retry"}
                          </button>
                        </div>
                      ) : null}
                      {embeddingDownloadBusy ? (
                        <span className="settings-field-hint" style={{ marginLeft: "auto" }}>
                          Download progress is shown in the banner.
                        </span>
                      ) : null}
                      {activeEmbeddingModelIsDefault && !embeddingDownloadBusy ? (
                        <button
                          className="btn btn--primary"
                          type="button"
                          onClick={() => void handleClearEmbeddingModel()}
                          disabled={embeddingModelSubmitting === "clear"}
                          style={{ marginLeft: "auto" }}
                        >
                          {embeddingModelSubmitting === "clear" ? "Clearing..." : "Clear"}
                        </button>
                      ) : null}
                    </div>
                  </SettingsModalSection>

                  <SettingsModalSection title="Custom Model">
                    <ul className="settings-field-hint" style={{ margin: "0 0 12px 18px", padding: 0 }}>
                      <li>Hugging Face sentence-transformer model with an XLM-RoBERTa/e5-compatible config.</li>
                      <li>Requires tokenizer files plus root-level safetensors weights.</li>
                      <li>ONNX, GGUF, Ollama, and other model architectures are not supported here yet.</li>
                    </ul>
                    <div className="users-table-wrap" style={{ marginBottom: 12 }}>
                      <table className="users-table">
                        <thead>
                          <tr>
                            <th className="users-th">Model</th>
                            <th className="users-th">Source</th>
                            <th className="users-th">Added</th>
                            <th className="users-th">Size</th>
                            <th className="users-th">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeCustomEmbeddingModel || partialCustomEmbeddingModel ? (
                            <tr>
                              <td className="users-td">
                                <div>{(activeCustomEmbeddingModel ?? partialCustomEmbeddingModel)?.displayName}</div>
                                <div className="users-td--muted">{(activeCustomEmbeddingModel ?? partialCustomEmbeddingModel)?.modelDir}</div>
                                {partialCustomEmbeddingModel ? (
                                  <div className="users-td--muted">Partial download</div>
                                ) : null}
                              </td>
                              <td className="users-td users-td--muted" style={{ whiteSpace: "nowrap" }}>
                                {(activeCustomEmbeddingModel ?? partialCustomEmbeddingModel)?.repoId === "local-folder"
                                  ? "Local folder"
                                  : (activeCustomEmbeddingModel ?? partialCustomEmbeddingModel)?.repoId}
                              </td>
                              <td className="users-td users-td--muted" style={{ whiteSpace: "nowrap" }}>
                                {formatEmbeddingModelDate((activeCustomEmbeddingModel ?? partialCustomEmbeddingModel)?.downloadedAtMs)}
                              </td>
                              <td className="users-td users-td--muted" style={{ whiteSpace: "nowrap" }}>
                                {formatBytes((activeCustomEmbeddingModel ?? partialCustomEmbeddingModel)?.bytes ?? 0)}
                              </td>
                              <td className="users-td" style={{ whiteSpace: "nowrap" }}>
                                <div className="project-export-actions project-export-actions--modal">
                                  <button
                                    className="btn"
                                    type="button"
                                    onClick={() => void handleClearEmbeddingModel()}
                                    disabled={embeddingModelSubmitting === "clear" || embeddingDownloadBusy}
                                  >
                                    {embeddingModelSubmitting === "clear" ? "Clearing..." : "Clear"}
                                  </button>
                                  {partialCustomEmbeddingModel ? (
                                    <button
                                      className="btn btn--primary"
                                      type="button"
                                      onClick={() => void handleRetryCustomEmbeddingModel(partialCustomEmbeddingModel.repoId)}
                                      disabled={embeddingModelSubmitting === "custom-download" || embeddingDownloadBusy}
                                    >
                                      {embeddingModelSubmitting === "custom-download" ? "Starting..." : "Retry"}
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          ) : (
                            <tr>
                              <td className="users-td users-td--muted" colSpan={5}>
                                No custom embedding models are currently downloaded or linked.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="project-export-actions project-export-actions--modal" style={{ justifyContent: "flex-end" }}>
                      <button
                        className="btn"
                        type="button"
                        onClick={() => setActiveEmbeddingModelModal("folder")}
                        disabled={embeddingDownloadBusy}
                      >
                        Select Folder
                      </button>
                      <button
                        className="btn btn--primary"
                        type="button"
                        onClick={() => setActiveEmbeddingModelModal("download")}
                        disabled={embeddingDownloadBusy}
                      >
                        Download
                      </button>
                    </div>
                  </SettingsModalSection>
                </div>
              ) : (
                <div className="app-settings-modal-sections">
                  <SettingsModalSection title="Local Providers" className="app-settings-modal-section--compact-controls">
                    <div className="project-export-actions project-export-actions--modal admin-local-provider-add-row" style={{ justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        className="btn btn--primary admin-local-provider-add-button"
                        aria-label="Add local provider"
                        title="Add local provider"
                        onClick={openLocalProviderModal}
                        disabled={!installationSettings || aiAssistPolicySaving}
                      >
                        <PlusIcon className="admin-local-provider-add-icon" />
                      </button>
                    </div>
                    <div className="users-table-wrap postgres-users-table-wrap" style={{ maxHeight: 260 }}>
                      <table className="users-table" style={{ tableLayout: "fixed", width: "100%" }}>
                        <thead>
                          <tr>
                            <th className="users-th" style={{ width: "28%" }}>Provider</th>
                            <th className="users-th" style={{ width: "34%" }}>Endpoint</th>
                            <th className="users-th" style={{ width: "22%" }}>Models</th>
                            <th className="users-th" style={{ width: 64, textAlign: "right" }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {!savedLocalLlmProvider || !aiAssistLlmSettings ? (
                            <tr>
                              <td className="users-td users-td--muted" colSpan={4}>
                                No local providers configured.
                              </td>
                            </tr>
                          ) : (
                            <tr className="users-row">
                              <td className="users-td users-td--name">{savedLocalLlmProvider.label}</td>
                              <td className="users-td users-td--muted">
                                {aiAssistLlmSettings.ollamaProtocol}://{aiAssistLlmSettings.ollamaHost}:{aiAssistLlmSettings.ollamaPort}
                              </td>
                              <td className="users-td">
                                {savedLocalEnabledModels.length ? `${savedLocalEnabledModels.length} enabled` : "All listed models"}
                              </td>
                              <td className="users-td snapshot-table-actions">
                                <button
                                  type="button"
                                  className="snapshot-actions-trigger"
                                  onPointerDown={(event) => event.stopPropagation()}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    const rect = event.currentTarget.getBoundingClientRect();
                                    setManageProjectMenu(null);
                                    setManageUserMenu(null);
                                    setCloudProviderMenu(null);
                                    setLocalProviderMenu((current) => current ? null : {
                                      x: Math.max(8, rect.right - 160),
                                      y: rect.bottom + 4,
                                    });
                                  }}
                                  disabled={!installationSettings || aiAssistPolicySaving}
                                  aria-label={`Actions for ${savedLocalLlmProvider.label}`}
                                  aria-expanded={Boolean(localProviderMenu)}
                                  title="Provider actions"
                                >
                                  ...
                                </button>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </SettingsModalSection>

                  <SettingsModalSection title="Cloud Providers" className="app-settings-modal-section--compact-controls">
                    <div className="project-export-actions project-export-actions--modal admin-local-provider-add-row" style={{ justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        className="btn btn--primary admin-local-provider-add-button"
                        aria-label="Add cloud provider"
                        title="Add cloud provider"
                        onClick={openCloudProviderModal}
                        disabled={!installationSettings || aiAssistPolicySaving}
                      >
                        <PlusIcon className="admin-local-provider-add-icon" />
                      </button>
                    </div>
                    <div className="users-table-wrap postgres-users-table-wrap" style={{ maxHeight: 260 }}>
                      <table className="users-table" style={{ tableLayout: "fixed", width: "100%" }}>
                        <thead>
                          <tr>
                            <th className="users-th" style={{ width: "32%" }}>Provider</th>
                            <th className="users-th" style={{ width: "32%" }}>Secret</th>
                            <th className="users-th" style={{ width: "20%" }}>Models</th>
                            <th className="users-th" style={{ width: 64, textAlign: "right" }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {!savedCloudLlmProvider || !aiAssistLlmSettings ? (
                            <tr>
                              <td className="users-td users-td--muted" colSpan={4}>
                                No cloud providers configured.
                              </td>
                            </tr>
                          ) : (
                            <tr className="users-row">
                              <td className="users-td users-td--name">{savedCloudLlmProvider.label}</td>
                              <td className="users-td users-td--muted">
                                {aiAssistLlmSettings.cloudApiSecret.trim() ? "Configured" : "Missing"}
                              </td>
                              <td className="users-td">
                                {savedCloudEnabledModels.length ? `${savedCloudEnabledModels.length} enabled` : "All listed models"}
                              </td>
                              <td className="users-td snapshot-table-actions">
                                <button
                                  type="button"
                                  className="snapshot-actions-trigger"
                                  onPointerDown={(event) => event.stopPropagation()}
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    const rect = event.currentTarget.getBoundingClientRect();
                                    setManageProjectMenu(null);
                                    setManageUserMenu(null);
                                    setLocalProviderMenu(null);
                                    setCloudProviderMenu((current) => current ? null : {
                                      x: Math.max(8, rect.right - 160),
                                      y: rect.bottom + 4,
                                    });
                                  }}
                                  disabled={!installationSettings || aiAssistPolicySaving}
                                  aria-label={`Actions for ${savedCloudLlmProvider.label}`}
                                  aria-expanded={Boolean(cloudProviderMenu)}
                                  title="Provider actions"
                                >
                                  ...
                                </button>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </SettingsModalSection>

                  <SettingsModalSection title="Generation Defaults">
                    <fieldset className="llm-settings-grid" disabled={!installationSettings || aiAssistPolicySaving} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
                      <label className="form-label">
                        Temperature
                        <input
                          className="form-input"
                          type="number"
                          min={0}
                          max={2}
                          step={0.1}
                          value={aiAssistLlmSettings?.ollamaTemperature ?? 0.2}
                          onChange={(event) => updateAiAssistLlmSettings((current) => ({
                            ...current,
                            ollamaTemperature: Math.max(0, Math.min(2, Number(event.target.value) || 0)),
                          }))}
                        />
                      </label>
                      <label className="form-label">
                        Context window
                        <input
                          className="form-input"
                          type="number"
                          min={256}
                          max={131072}
                          value={aiAssistLlmSettings?.ollamaNumCtx ?? 8192}
                          onChange={(event) => updateAiAssistLlmSettings((current) => ({
                            ...current,
                            ollamaNumCtx: clampSettingsInteger(event.target.value, current.ollamaNumCtx, 256, 131072),
                          }))}
                        />
                      </label>
                      <label className="form-label">
                        Keep alive minutes
                        <input
                          className="form-input"
                          type="number"
                          min={0}
                          max={1440}
                          value={aiAssistLlmSettings?.ollamaKeepAliveMinutes ?? 10}
                          onChange={(event) => updateAiAssistLlmSettings((current) => ({
                            ...current,
                            ollamaKeepAliveMinutes: clampSettingsInteger(event.target.value, current.ollamaKeepAliveMinutes, 0, 1440),
                          }))}
                        />
                      </label>
                      <label className="form-label">
                        Relevant segment shortlist
                        <input
                          className="form-input"
                          type="number"
                          min={1}
                          max={50}
                          value={aiAssistLlmSettings?.ollamaRelevantSegmentsCandidateLimit ?? 12}
                          onChange={(event) => updateAiAssistLlmSettings((current) => {
                            const candidateLimit = clampSettingsInteger(event.target.value, current.ollamaRelevantSegmentsCandidateLimit, 1, 50);
                            return {
                              ...current,
                              ollamaRelevantSegmentsCandidateLimit: candidateLimit,
                              ollamaRelevantSegmentsMaxResults: Math.min(current.ollamaRelevantSegmentsMaxResults, candidateLimit),
                            };
                          })}
                        />
                      </label>
                      <label className="form-label">
                        Relevant segments returned
                        <input
                          className="form-input"
                          type="number"
                          min={1}
                          max={aiAssistLlmSettings?.ollamaRelevantSegmentsCandidateLimit ?? 12}
                          value={aiAssistLlmSettings?.ollamaRelevantSegmentsMaxResults ?? 6}
                          onChange={(event) => updateAiAssistLlmSettings((current) => ({
                            ...current,
                            ollamaRelevantSegmentsMaxResults: clampSettingsInteger(
                              event.target.value,
                              current.ollamaRelevantSegmentsMaxResults,
                              1,
                              current.ollamaRelevantSegmentsCandidateLimit,
                            ),
                          }))}
                        />
                      </label>
                      <label className="form-label">
                        Document timeout
                        <input
                          className="form-input"
                          type="number"
                          min={30}
                          max={3600}
                          value={aiAssistLlmSettings?.ollamaDocumentProcessingTimeoutSeconds ?? 1800}
                          onChange={(event) => updateAiAssistLlmSettings((current) => ({
                            ...current,
                            ollamaDocumentProcessingTimeoutSeconds: clampSettingsInteger(
                              event.target.value,
                              current.ollamaDocumentProcessingTimeoutSeconds,
                              30,
                              3600,
                            ),
                          }))}
                        />
                      </label>
                    </fieldset>
                  </SettingsModalSection>
                </div>
              )}
            </div>
            <div className="app-settings-modal-footer">
              <span>{aiAssistPolicySaving ? "Saving..." : ""}</span>
              <button type="button" className="btn btn--primary" onClick={closeAiAssistModal}>Done</button>
            </div>
          </SettingsModal>
          {localProviderModalOpen && localProviderDraft ? (
            <SettingsModal
              title="Local Provider"
              onClose={closeLocalProviderModal}
            >
                <div className="app-settings-modal-body">
                  {aiAssistNotice ? <p className="settings-success">{aiAssistNotice}</p> : null}
                  {aiAssistError ? <p className="auth-error">{aiAssistError}</p> : null}
                  <div className="app-settings-modal-sections">
                    <SettingsModalSection title="Connection">
                      <fieldset className="llm-settings-grid" disabled={!installationSettings || aiAssistPolicySaving || adminLocalModelsBusy} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
                        <label className="form-label">
                          API provider
                          <select
                            className="form-input"
                            value={localProviderDraft.localProvider}
                            onChange={(event) => handleAdminLocalLlmProviderChange(event.target.value as LocalLlmProvider)}
                          >
                            {LOCAL_LLM_PROVIDER_OPTIONS.map((provider) => (
                              <option key={provider.value} value={provider.value}>{provider.label}</option>
                            ))}
                          </select>
                          {selectedLocalLlmProvider ? <span className="settings-field-hint">{selectedLocalLlmProvider.helpText}</span> : null}
                        </label>
                        <label className="form-label">
                          Protocol
                          <select
                            className="form-input"
                            value={localProviderDraft.ollamaProtocol}
                            onChange={(event) => updateLocalProviderDraft((current) => ({
                              ...current,
                              ollamaProtocol: event.target.value === "https" ? "https" : "http",
                            }))}
                          >
                            <option value="http">http</option>
                            <option value="https">https</option>
                          </select>
                        </label>
                        <label className="form-label">
                          Host URL
                          <input
                            className="form-input"
                            type="text"
                            value={localProviderDraft.ollamaHost}
                            onChange={(event) => updateLocalProviderDraft((current) => ({ ...current, ollamaHost: event.target.value }))}
                            placeholder={selectedLocalLlmProvider && selectedLocalLlmProvider.value !== "custom" ? selectedLocalLlmProvider.defaults.ollamaHost : ""}
                          />
                        </label>
                        <label className="form-label">
                          Port
                          <input
                            className="form-input"
                            type="number"
                            min={localProviderDraft.localProvider === "custom" ? 0 : 1}
                            max={65535}
                            value={localProviderDraft.localProvider === "custom" && localProviderDraft.ollamaPort === 0 ? "" : localProviderDraft.ollamaPort}
                            onChange={(event) => updateLocalProviderDraft((current) => ({
                              ...current,
                              ollamaPort: current.localProvider === "custom" && event.target.value.trim() === ""
                                ? 0
                                : clampSettingsInteger(event.target.value, current.ollamaPort, 1, 65535),
                            }))}
                          />
                        </label>
                        <label className="form-label">
                          Request timeout
                          <input
                            className="form-input"
                            type="number"
                            min={5}
                            max={600}
                            value={localProviderDraft.ollamaRequestTimeoutSeconds}
                            onChange={(event) => updateLocalProviderDraft((current) => ({
                              ...current,
                              ollamaRequestTimeoutSeconds: clampSettingsInteger(event.target.value, current.ollamaRequestTimeoutSeconds, 5, 600),
                            }))}
                          />
                        </label>
                      </fieldset>
                      <div className="project-export-actions project-export-actions--modal" style={{ justifyContent: "flex-end" }}>
                        <button
                          className="btn btn--primary"
                          type="button"
                          onClick={() => void handleAdminTestLocalLlmProvider()}
                          disabled={!installationSettings || aiAssistPolicySaving || adminLocalModelsBusy || !localProviderDraft.ollamaHost.trim() || localProviderDraft.ollamaPort <= 0}
                        >
                          {adminLocalModelsBusy ? "Testing..." : "Test"}
                        </button>
                      </div>
                    </SettingsModalSection>
                    <SettingsModalSection title="Models">
                      <div className="users-table-wrap postgres-users-table-wrap" style={{ maxHeight: 260 }}>
                        <table className="users-table" style={{ tableLayout: "fixed", width: "100%" }}>
                          <thead>
                            <tr>
                              <th className="users-th" style={{ width: "42%" }}>Model</th>
                              <th className="users-th" style={{ width: 260, whiteSpace: "nowrap" }}>Enabled</th>
                            </tr>
                          </thead>
                          <tbody>
                            {adminLocalModels.length === 0 ? (
                              <tr>
                                <td className="users-td users-td--muted" colSpan={2}>
                                  Test the local provider to list available models.
                                </td>
                              </tr>
                            ) : adminLocalModels.map((model) => {
                              const enabled = adminLocalEnabledModels === undefined || adminLocalEnabledModels.includes(model.name);
                              return (
                                <tr key={model.name} className="users-row">
                                  <td className="users-td users-td--name" style={{ minWidth: 0 }}>
                                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={model.name}>
                                      {model.name}
                                    </div>
                                  </td>
                                  <td className="users-td" style={{ whiteSpace: "nowrap" }}>
                                    <div className="segmented-control" role="tablist" aria-label={`Availability for ${model.name}`} style={{ width: "fit-content", flexWrap: "nowrap" }}>
                                      <button
                                        type="button"
                                        className={!enabled ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                                        disabled={aiAssistPolicySaving}
                                        onClick={() => handleAdminLocalModelToggle(model.name, false)}
                                      >
                                        Disabled
                                      </button>
                                      <button
                                        type="button"
                                        className={enabled ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                                        disabled={aiAssistPolicySaving}
                                        onClick={() => handleAdminLocalModelToggle(model.name, true)}
                                      >
                                        Enabled
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </SettingsModalSection>
                  </div>
                </div>
                <div className="app-settings-modal-footer">
                  <button type="button" className="btn" onClick={closeLocalProviderModal} disabled={adminLocalModelsBusy || aiAssistPolicySaving}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => void saveLocalProviderDraft()}
                    disabled={adminLocalModelsBusy || aiAssistPolicySaving || !localProviderDraft.ollamaHost.trim() || localProviderDraft.ollamaPort <= 0}
                  >
                    {aiAssistPolicySaving ? "Saving..." : "Save Provider"}
                  </button>
                </div>
            </SettingsModal>
          ) : null}
          {cloudProviderModalOpen && cloudProviderDraft ? (
            <SettingsModal
              title="Cloud Provider"
              onClose={closeCloudProviderModal}
            >
                <div className="app-settings-modal-body">
                  <div className="app-settings-modal-sections">
                    <SettingsModalSection title="Connection">
                      <fieldset className="llm-settings-grid" disabled={!installationSettings || aiAssistPolicySaving} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
                        <label className="form-label">
                          API provider
                          <select
                            className="form-input"
                            value={cloudProviderDraft.cloudProvider}
                            onChange={(event) => handleAdminCloudLlmProviderChange(event.target.value as CloudLlmProvider | "")}
                          >
                            <option value="">None</option>
                            {CLOUD_LLM_PROVIDER_OPTIONS.map((provider) => (
                              <option key={provider.value} value={provider.value}>{provider.label}</option>
                            ))}
                          </select>
                          {selectedCloudLlmProvider ? (
                            <span className="settings-field-hint">
                              {selectedCloudLlmProvider.helpText}{" "}
                              <button
                                className="settings-inline-link settings-inline-link--button"
                                type="button"
                                onClick={() => void openUrl(selectedCloudLlmProvider.keyUrl)}
                              >
                                Open key setup
                              </button>
                            </span>
                          ) : null}
                        </label>
                        <label className="form-label">
                          API secret
                          <input
                            className="form-input"
                            type="password"
                            autoComplete="off"
                            value={cloudProviderDraft.cloudApiSecret}
                            onChange={(event) => updateCloudProviderDraft((current) => ({ ...current, cloudApiSecret: event.target.value }))}
                            placeholder={selectedCloudLlmProvider ? `${selectedCloudLlmProvider.label} API secret` : ""}
                          />
                        </label>
                      </fieldset>
                      <div className="project-export-actions project-export-actions--modal" style={{ justifyContent: "flex-end" }}>
                        <button
                          className="btn btn--primary"
                          type="button"
                          onClick={() => void handleAdminTestCloudLlmProvider()}
                          disabled={!installationSettings || aiAssistPolicySaving || adminCloudModelsBusy || !cloudProviderDraft.cloudApiSecret.trim()}
                        >
                          {adminCloudModelsBusy ? "Testing..." : "Test"}
                        </button>
                      </div>
                    </SettingsModalSection>
                    <SettingsModalSection title="Models">
                      <div className="users-table-wrap postgres-users-table-wrap" style={{ maxHeight: 260 }}>
                        <table className="users-table" style={{ tableLayout: "fixed", width: "100%" }}>
                          <thead>
                            <tr>
                              <th className="users-th" style={{ width: "38%" }}>Model</th>
                              <th className="users-th" style={{ width: 140, whiteSpace: "nowrap" }}>Publisher</th>
                              <th className="users-th" style={{ width: 260, whiteSpace: "nowrap" }}>Enabled</th>
                            </tr>
                          </thead>
                          <tbody>
                            {adminCloudModels.length === 0 ? (
                              <tr>
                                <td className="users-td users-td--muted" colSpan={3}>
                                  Test the cloud provider to list available models.
                                </td>
                              </tr>
                            ) : adminCloudModels.map((model) => {
                              const enabled = adminCloudEnabledModels === undefined || adminCloudEnabledModels.includes(model.id);
                              return (
                                <tr key={model.id} className="users-row">
                                  <td className="users-td users-td--name" style={{ minWidth: 0 }}>
                                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={model.name}>
                                      {model.name}
                                    </div>
                                    <div className="users-td--muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={model.id}>
                                      {model.id}
                                    </div>
                                  </td>
                                  <td className="users-td users-td--muted" style={{ whiteSpace: "nowrap" }}>
                                    {model.publisher ?? "-"}
                                  </td>
                                  <td className="users-td" style={{ whiteSpace: "nowrap" }}>
                                    <div className="segmented-control" role="tablist" aria-label={`Availability for ${model.name}`} style={{ width: "fit-content", flexWrap: "nowrap" }}>
                                      <button
                                        type="button"
                                        className={!enabled ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                                        disabled={aiAssistPolicySaving}
                                        onClick={() => handleAdminCloudModelToggle(model.id, false)}
                                      >
                                        Disabled
                                      </button>
                                      <button
                                        type="button"
                                        className={enabled ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                                        disabled={aiAssistPolicySaving}
                                        onClick={() => handleAdminCloudModelToggle(model.id, true)}
                                      >
                                        Enabled
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </SettingsModalSection>
                  </div>
                </div>
                <div className="app-settings-modal-footer">
                  <button type="button" className="btn" onClick={closeCloudProviderModal} disabled={adminCloudModelsBusy || aiAssistPolicySaving}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => void saveCloudProviderDraft()}
                    disabled={adminCloudModelsBusy || aiAssistPolicySaving || !cloudProviderDraft.cloudApiSecret.trim()}
                  >
                    {aiAssistPolicySaving ? "Saving..." : "Save Provider"}
                  </button>
                </div>
            </SettingsModal>
          ) : null}
          {localProviderMenu ? (
            <div
              className="context-menu"
              style={{ left: localProviderMenu.x, top: localProviderMenu.y, minWidth: 160, zIndex: 1500 }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              <button
                type="button"
                className="context-menu-item"
                onClick={() => {
                  setLocalProviderMenu(null);
                  openLocalProviderModal();
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="context-menu-item context-menu-item--danger"
                onClick={() => void removeLocalProvider()}
                disabled={aiAssistPolicySaving}
              >
                Remove
              </button>
            </div>
          ) : null}
          {cloudProviderMenu ? (
            <div
              className="context-menu"
              style={{ left: cloudProviderMenu.x, top: cloudProviderMenu.y, minWidth: 160, zIndex: 1500 }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              <button
                type="button"
                className="context-menu-item"
                onClick={() => {
                  setCloudProviderMenu(null);
                  openCloudProviderModal();
                }}
              >
                Edit
              </button>
              <button
                type="button"
                className="context-menu-item context-menu-item--danger"
                onClick={() => void removeCloudProvider()}
                disabled={aiAssistPolicySaving}
              >
                Remove
              </button>
            </div>
          ) : null}
          {activeEmbeddingModelModal === "download" ? (
            <SettingsModal
              title="Download Custom Model"
              onClose={() => setActiveEmbeddingModelModal(null)}
            >
                <div className="app-settings-modal-body">
                  <label className="settings-field">
                    <span className="settings-row-label">Model URL or repository</span>
                    <input
                      className="form-input"
                      type="text"
                      value={customEmbeddingModelUrl}
                      onChange={(event) => setCustomEmbeddingModelUrl(event.target.value)}
                      placeholder="https://huggingface.co/intfloat/multilingual-e5-large"
                      disabled={embeddingDownloadBusy || embeddingModelSubmitting === "custom-download"}
                    />
                    <span className="settings-field-hint">Use a compatible Hugging Face model URL or repository id.</span>
                  </label>
                </div>
                <div className="app-settings-modal-footer">
                  <span />
                  <button
                    className="btn btn--primary"
                    type="button"
                    onClick={() => void handleDownloadCustomEmbeddingModel()}
                    disabled={embeddingDownloadBusy || embeddingModelSubmitting === "custom-download" || !customEmbeddingModelUrl.trim()}
                  >
                    {embeddingModelSubmitting === "custom-download" ? "Starting..." : "Download"}
                  </button>
                </div>
            </SettingsModal>
          ) : null}
          {activeEmbeddingModelModal === "folder" ? (
            <SettingsModal
              title="Select Local Model Folder"
              onClose={() => setActiveEmbeddingModelModal(null)}
            >
                <div className="app-settings-modal-body">
                  <div
                    className={`doc-dropzone${customEmbeddingFolderPath ? " doc-dropzone--filled" : ""}`}
                    role="button"
                    tabIndex={0}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "copy";
                    }}
                    onDrop={handleEmbeddingFolderDrop}
                    onClick={() => void chooseCustomEmbeddingFolder()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void chooseCustomEmbeddingFolder();
                      }
                    }}
                  >
                    <span className="doc-dropzone-icon">↑</span>
                    {customEmbeddingFolderPath ? (
                      <>
                        <span className="doc-dropzone-filename">{customEmbeddingFolderPath}</span>
                        <span className="doc-dropzone-hint">Ready to import</span>
                      </>
                    ) : (
                      <>
                        <span className="doc-dropzone-primary">Click to browse or drag and drop a folder</span>
                        <span className="doc-dropzone-hint">Choose an already-downloaded compatible embedding model folder.</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="app-settings-modal-footer">
                  <span />
                  <button
                    className="btn btn--primary"
                    type="button"
                    onClick={() => void handleImportEmbeddingModelFolder(customEmbeddingFolderPath || undefined)}
                    disabled={embeddingDownloadBusy || embeddingModelSubmitting === "import" || !customEmbeddingFolderPath}
                  >
                    {embeddingModelSubmitting === "import" ? "Importing..." : "Import"}
                  </button>
                </div>
            </SettingsModal>
          ) : null}
        </>
      ) : null}

      {activeModal === "updates" ? (
        <SettingsModal title="Back-up and Updates" onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                {updatesNotice ? <p className="settings-inline-success">{updatesNotice}</p> : null}
                {updatesError ? <p className="auth-error">{updatesError}</p> : null}
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Backup All Data</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <p className="settings-muted-text">
                      Backup all the data in the current version. You can import this data after installing a newer version of KanQual.
                    </p>
                    <div className="backup-create-actions">
                      <button
                        type="button"
                        className="btn"
                        disabled={upgradeBackupSubmitting}
                        onClick={() => {
                          setUpdatesError("");
                          setUpdatesNotice("");
                          setUpgradeBackupPassword("");
                          setUpgradeBackupPasswordVisible(false);
                          setShowUpgradeBackupPasswordModal(true);
                        }}
                      >
                        {upgradeBackupSubmitting ? "Backing up..." : "Backup"}
                      </button>
                    </div>
                  </div>
                </section>
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Backup Diagnostics</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="home-restricted-list" style={{ marginBottom: 12 }}>
                      <div className="home-restricted-item">
                        <span className="home-restricted-label">Default folder</span>
                        <span className="home-restricted-value">{upgradeBackupDiagnostics?.folderPath || "-"}</span>
                      </div>
                      <div className="home-restricted-item">
                        <span className="home-restricted-label">Last successful backup</span>
                        <span className="home-restricted-value">
                          {upgradeBackupDiagnostics?.lastSuccessfulBackup
                            ? formatPostgresTimestampMs(upgradeBackupDiagnostics.lastSuccessfulBackup.createdAtMs)
                            : "-"}
                        </span>
                      </div>
                    </div>
                    <div className="backup-list">
                      {upgradeBackupDiagnosticsLoading ? (
                        <div className="empty-state backup-empty-state">
                          <p>Loading backups...</p>
                        </div>
                      ) : upgradeBackupDiagnostics?.backups.length ? (
                        <div className="project-log-table-wrap snapshot-table-wrap">
                          <table className="project-log-table snapshot-table">
                            <thead>
                              <tr>
                                <th>Created</th>
                                <th>KanQual</th>
                                <th>PostgreSQL</th>
                                <th>Projects</th>
                                <th>Source Files</th>
                                <th>Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {upgradeBackupDiagnostics.backups.map((backup) => (
                                <tr key={backup.path}>
                                  <td className="log-cell log-cell--time snapshot-created-cell">
                                    <span>{formatPostgresTimestampMs(backup.createdAtMs)}</span>
                                  </td>
                                  <td className="log-cell log-cell--time">{backup.kanqualVersion || "-"}</td>
                                  <td className="log-cell log-cell--time">{backup.postgresVersion || "-"}</td>
                                  <td className="log-cell log-cell--time">{backup.source === "folder" ? "-" : backup.projectCount}</td>
                                  <td className="log-cell log-cell--time">{backup.source === "folder" ? "-" : backup.storageFileCount}</td>
                                  <td className="log-cell log-cell--time">{formatBytes(backup.bytes)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="empty-state backup-empty-state">
                          <p>No backups yet.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
                    <h3>Updates</h3>
                  </div>
                  <div className="app-settings-modal-section-body">
                    <div className="settings-toggle-row">
                      <span>
                        <strong>Automatically check for updates</strong>
                      </span>
                      <div className="segmented-control" role="group" aria-label="Automatic update checks">
                        {[
                          { value: false, label: "Disabled" },
                          { value: true, label: "Enabled" },
                        ].map((option) => (
                          <button
                            key={option.label}
                            type="button"
                            className={(installationSettings?.updatesAutoCheck ?? true) === option.value ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                            disabled={!installationSettings}
                            onClick={() => {
                              if (!installationSettings) return;
                              void persistInstallationSettings(
                                { ...installationSettings, updatesAutoCheck: option.value },
                                "Update preferences saved.",
                              );
                            }}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="settings-toggle-row">
                      <span>
                        <strong>Show update available banner to users</strong>
                      </span>
                      <div className="segmented-control" role="group" aria-label="Update available banner">
                        {[
                          { value: false, label: "Disabled" },
                          { value: true, label: "Enabled" },
                        ].map((option) => (
                          <button
                            key={option.label}
                            type="button"
                            className={(installationSettings?.updatesBannerEnabled ?? true) === option.value ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                            disabled={!installationSettings}
                            onClick={() => {
                              if (!installationSettings) return;
                              void persistInstallationSettings(
                                { ...installationSettings, updatesBannerEnabled: option.value },
                                "Update preferences saved.",
                              );
                            }}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-info">
                        <div className="settings-row-label">{t("appSettings.updates.latestReleasesLabel")}</div>
                      </div>
                      <button
                        className="btn"
                        type="button"
                        onClick={() => void openUrl(GITHUB_RELEASES_URL)}
                      >
                        {t("appSettings.updates.openReleasesPage")}
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button>
            </div>
        </SettingsModal>
      ) : null}

      {showUpgradeBackupPasswordModal ? (
        <SettingsModal
          title="Backup All Data"
          onClose={() => {
            if (!upgradeBackupSubmitting) setShowUpgradeBackupPasswordModal(false);
          }}
          closeDisabled={upgradeBackupSubmitting}
        >
            <form className="app-settings-modal-body" onSubmit={handleCreateUpgradeBackup}>
              <div className="settings-warning settings-warning--danger">
                Enter the administrator password to create an encrypted backup. This password will be required to restore the backup later.
              </div>
              <label className="form-label">
                Administrator Password
                <div className="password-input-wrap">
                  <input
                    className="form-input password-input-field"
                    type={upgradeBackupPasswordVisible ? "text" : "password"}
                    value={upgradeBackupPassword}
                    onChange={(event) => setUpgradeBackupPassword(event.target.value)}
                    autoComplete="current-password"
                    autoFocus
                    disabled={upgradeBackupSubmitting}
                  />
                  <button
                    type="button"
                    className="password-visibility-btn"
                    aria-label={upgradeBackupPasswordVisible ? "Hide password" : "Show password"}
                    aria-pressed={upgradeBackupPasswordVisible}
                    onClick={() => setUpgradeBackupPasswordVisible((current) => !current)}
                    disabled={upgradeBackupSubmitting}
                  >
                    <PasswordVisibilityIcon />
                  </button>
                </div>
              </label>
              {updatesError ? <p className="auth-error">{updatesError}</p> : null}
              <div className="form-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowUpgradeBackupPasswordModal(false)}
                  disabled={upgradeBackupSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={upgradeBackupSubmitting || !upgradeBackupPassword.trim()}
                >
                  {upgradeBackupSubmitting ? "Backing up..." : "Backup"}
                </button>
              </div>
            </form>
        </SettingsModal>
      ) : null}

      {showUpgradeBackupSuccessModal && lastUpgradeBackup ? (
        <SettingsModal title="Backup Complete" onClose={() => setShowUpgradeBackupSuccessModal(false)}>
            <div className="app-settings-modal-body">
              <p className="settings-inline-success">KanQual finished backing up all data.</p>
              <p className="settings-muted-text">
                KanQual saved the backup in its managed backup folder. You can copy it somewhere else if you want an extra copy.
              </p>
              {upgradeBackupCopyNotice ? <p className="settings-inline-success">{upgradeBackupCopyNotice}</p> : null}
              {upgradeBackupCopyError ? <p className="auth-error">{upgradeBackupCopyError}</p> : null}
              <div className="settings-diagnostics-grid settings-diagnostics-grid--compact">
                <div>
                  <span>Managed Path</span>
                  <strong>{lastUpgradeBackup.path}</strong>
                </div>
                <div>
                  <span>Projects</span>
                  <strong>{lastUpgradeBackup.projectCount}</strong>
                </div>
                <div>
                  <span>Files</span>
                  <strong>{lastUpgradeBackup.storageFileCount}</strong>
                </div>
                <div>
                  <span>Size</span>
                  <strong>{formatBytes(lastUpgradeBackup.bytes)}</strong>
                </div>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <button
                type="button"
                className="btn"
                onClick={() => void handleCopyLastUpgradeBackup()}
                disabled={upgradeBackupCopying}
              >
                {upgradeBackupCopying ? "Copying..." : "Copy to..."}
              </button>
              <button type="button" className="btn btn--primary" onClick={() => setShowUpgradeBackupSuccessModal(false)}>
                Done
              </button>
            </div>
        </SettingsModal>
      ) : null}

      {activeModal === "diagnostics" ? (
        <SettingsModal title={t("appSettings.sectionTitles.diagnostics")} onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <SettingsModalSection
                  title="Database status"
                  action={(
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        void refreshPostgresDetails();
                      }}
                      disabled={loading}
                    >
                      {loading ? "Refreshing..." : t("appSettings.diagnostics.recheck")}
                    </button>
                  )}
                >
                  <div className="home-restricted-list">
                    <div className="home-restricted-item"><span className="home-restricted-label">Host</span><span className="home-restricted-value">{status ? `${status.host}:${status.port}` : "-"}</span></div>
                    <div className="home-restricted-item"><span className="home-restricted-label">Bundled database reachable</span><span className="home-restricted-value">{status?.serviceReachable ? "Yes" : "No"}</span></div>
                    <div className="home-restricted-item"><span className="home-restricted-label">Control database ready</span><span className="home-restricted-value">{status?.bootstrapApplied ? "Yes" : "No"}</span></div>
                    <div className="home-restricted-item"><span className="home-restricted-label">Setup finalized</span><span className="home-restricted-value">{status?.adminHandoffCompleted ? "Yes" : "No"}</span></div>
                    <div className="home-restricted-item"><span className="home-restricted-label">Database account</span><span className="home-restricted-value">{databaseAccountStatus}</span></div>
                  </div>
                </SettingsModalSection>
                <SettingsModalSection
                  title="Bundled runtime"
                  action={(
                    <div className="settings-inline-actions">
                      <button type="button" className="btn" onClick={() => void handlePrepareBundledRuntimeDirs()} disabled={loading}>
                        Prepare
                      </button>
                      <button type="button" className="btn btn--secondary" onClick={() => void handleStartBundledPostgresRuntime()} disabled={loading || !bundledPostgresStatus?.initialized}>
                        Start
                      </button>
                      <button type="button" className="btn" onClick={() => void handleStopBundledPostgresRuntime()} disabled={loading || !bundledPostgresStatus?.reachable}>
                        Stop
                      </button>
                    </div>
                  )}
                >
                  <div className="home-restricted-list">
                    <div className="home-restricted-item"><span className="home-restricted-label">Distribution</span><span className="home-restricted-value">{bundledPostgresStatus?.paths.distribution ?? "-"}</span></div>
                    <div className="home-restricted-item"><span className="home-restricted-label">Expected PostgreSQL</span><span className="home-restricted-value">{bundledPostgresStatus?.paths.expectedVersion ?? "-"}</span></div>
                    <div className="home-restricted-item"><span className="home-restricted-label">Runtime root</span><span className="home-restricted-value">{yesNo(bundledPostgresStatus?.runtimeRootExists)}</span></div>
                    <div className="home-restricted-item"><span className="home-restricted-label">Binary folder</span><span className="home-restricted-value">{yesNo(bundledPostgresStatus?.binDirExists)}</span></div>
                    <div className="home-restricted-item"><span className="home-restricted-label">Server binary</span><span className="home-restricted-value">{yesNo(bundledPostgresStatus?.postgresBinaryExists)}</span></div>
                    <div className="home-restricted-item"><span className="home-restricted-label">Initdb binary</span><span className="home-restricted-value">{yesNo(bundledPostgresStatus?.initdbBinaryExists)}</span></div>
                    <div className="home-restricted-item"><span className="home-restricted-label">Control binary</span><span className="home-restricted-value">{yesNo(bundledPostgresStatus?.pgCtlBinaryExists)}</span></div>
                    <div className="home-restricted-item"><span className="home-restricted-label">Dump binary</span><span className="home-restricted-value">{yesNo(bundledPostgresStatus?.pgDumpBinaryExists)}</span></div>
                    <div className="home-restricted-item"><span className="home-restricted-label">Data root</span><span className="home-restricted-value">{yesNo(bundledPostgresStatus?.dataRootExists)}</span></div>
                    <div className="home-restricted-item"><span className="home-restricted-label">Data directory</span><span className="home-restricted-value">{yesNo(bundledPostgresStatus?.dataDirExists)}</span></div>
                    <div className="home-restricted-item"><span className="home-restricted-label">Initialized</span><span className="home-restricted-value">{yesNo(bundledPostgresStatus?.initialized)}</span></div>
                    <div className="home-restricted-item"><span className="home-restricted-label">Initialized version</span><span className="home-restricted-value">{bundledPostgresStatus?.initializedVersion ?? "-"}</span></div>
                    <div className="home-restricted-item"><span className="home-restricted-label">Version matches</span><span className="home-restricted-value">{yesNo(bundledPostgresStatus?.expectedVersionMatches)}</span></div>
                    <div className="home-restricted-item"><span className="home-restricted-label">Probe reachable</span><span className="home-restricted-value">{bundledPostgresStatus ? `${yesNo(bundledPostgresStatus.reachable)} (${bundledPostgresStatus.probeHost}:${bundledPostgresStatus.probePort})` : "-"}</span></div>
                    <div className="home-restricted-item"><span className="home-restricted-label">Process marker</span><span className="home-restricted-value">{bundledPostgresStatus?.postmasterPidExists ? `Yes${bundledPostgresStatus.postmasterPid ? ` (${bundledPostgresStatus.postmasterPid})` : ""}` : "No"}</span></div>
                    <div className="home-restricted-item"><span className="home-restricted-label">Marker process alive</span><span className="home-restricted-value">{yesNo(bundledPostgresStatus?.postmasterPidRunning)}</span></div>
                    <div className="home-restricted-item"><span className="home-restricted-label">Writable data root</span><span className="home-restricted-value">{yesNo(bundledPostgresPreflight?.dataRootWritable)}</span></div>
                    <div className="home-restricted-item"><span className="home-restricted-label">Safe data directory</span><span className="home-restricted-value">{yesNo(bundledPostgresPreflight?.dataDirEmptyOrMissing)}</span></div>
                    <div className="home-restricted-item"><span className="home-restricted-label">Required binaries</span><span className="home-restricted-value">{yesNo(bundledPostgresPreflight?.requiredBinariesAvailable)}</span></div>
                    <div className="home-restricted-item"><span className="home-restricted-label">Default port available</span><span className="home-restricted-value">{yesNo(bundledPostgresPreflight?.defaultPortAvailable)}</span></div>
                    <div className="home-restricted-item"><span className="home-restricted-label">Ready to initialize</span><span className="home-restricted-value">{yesNo(bundledPostgresPreflight?.canInitialize)}</span></div>
                  </div>
                  {runtimeNotice ? <p className="settings-success">{runtimeNotice}</p> : null}
                  {bundledPostgresPreflight?.issues.length ? (
                    <div className="settings-row settings-row--block">
                      <div className="settings-row-info">
                        <div className="settings-row-label">Initialization blockers</div>
                        <div className="settings-row-desc">
                          {bundledPostgresPreflight.issues.join(" ")}
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <div className="settings-row settings-row--block">
                    <div className="settings-row-info">
                      <div className="settings-row-label">Runtime path</div>
                      <code className="settings-code-line">{bundledPostgresStatus?.paths.runtimeRoot ?? "-"}</code>
                    </div>
                    <div className="settings-row-info">
                      <div className="settings-row-label">Data path</div>
                      <code className="settings-code-line">{bundledPostgresStatus?.paths.dataRoot ?? "-"}</code>
                    </div>
                    <div className="settings-row-info">
                      <div className="settings-row-label">Latest log</div>
                      <code className="settings-code-line">{bundledPostgresStatus?.latestLogPath ?? "-"}</code>
                    </div>
                    <div className="settings-row-info">
                      <div className="settings-row-label">Runtime diagnostics log</div>
                      <code className="settings-code-line">{bundledPostgresStatus?.paths.runtimeDiagnosticsLog ?? "-"}</code>
                    </div>
                  </div>
                </SettingsModalSection>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button>
            </div>
        </SettingsModal>
      ) : null}

      {activeModal === "administratorLog" ? (
        <SettingsModal title="Administrator Log" onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div
                    className="app-settings-modal-section-header app-settings-modal-section-header--default"
                    style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center" }}
                  >
                    <span />
                    <div
                      className="segmented-control"
                      role="tablist"
                      aria-label="Administrator log"
                      style={{ gridColumn: 2, justifySelf: "center", width: "max-content", flex: "0 0 auto" }}
                    >
                      <button
                        type="button"
                        className={`segmented-control-option ${adminAuditTab === "auth" ? "segmented-control-option--active" : ""}`}
                        onClick={() => setAdminAuditTab("auth")}
                      >
                        Users
                      </button>
                      <button
                        type="button"
                        className={`segmented-control-option ${adminAuditTab === "projects" ? "segmented-control-option--active" : ""}`}
                        onClick={() => setAdminAuditTab("projects")}
                      >
                        Projects
                      </button>
                    </div>
                    <div className="settings-inline-actions" style={{ gridColumn: 3, justifySelf: "end" }}>
                      <button
                        type="button"
                        className="codebook-icon-action"
                        onClick={() => void handleExportAdminLogCsv()}
                        aria-label="Export active administrator log table as CSV"
                        title="Export CSV"
                      >
                        <DownloadIcon className="filter-icon-svg" />
                      </button>
                      <button
                        type="button"
                        className="codebook-icon-action"
                        onClick={() => setAdminLogFilterOpen(true)}
                        aria-label="Filter active administrator log table"
                        title="Filter"
                      >
                        <FilterIcon className="filter-icon-svg" />
                      </button>
                    </div>
                  </div>
                  <div className="app-settings-modal-section-body">
                  {auditError ? <p className="auth-error">{auditError}</p> : null}
                  {auditLoading ? (
                    <div className="empty-state empty-state--compact">
                      <p>Loading audit log...</p>
                    </div>
                  ) : adminAuditTab === "auth" ? (
                    authAuditEntries.length === 0 ? (
                      <div className="empty-state empty-state--compact">
                        <p>No authentication events yet.</p>
                      </div>
                    ) : (
                      <div className="users-table-wrap postgres-users-table-wrap" style={{ maxHeight: 520 }}>
                        <table className="users-table" style={{ tableLayout: "auto", width: "100%" }}>
                          <thead>
                            <tr>
                              <th
                                className={`users-th${adminUsersLogSortColumn === "time" ? " users-th--sorted" : ""}`}
                                style={{ whiteSpace: "nowrap" }}
                                onClick={() => toggleAdminUsersLogSort("time")}
                              >
                                Time<span className="users-sort-icon">{sortIcon(adminUsersLogSortColumn === "time", adminUsersLogSortDirection)}</span>
                              </th>
                              <th
                                className={`users-th${adminUsersLogSortColumn === "event" ? " users-th--sorted" : ""}`}
                                onClick={() => toggleAdminUsersLogSort("event")}
                              >
                                Event<span className="users-sort-icon">{sortIcon(adminUsersLogSortColumn === "event", adminUsersLogSortDirection)}</span>
                              </th>
                              <th
                                className={`users-th${adminUsersLogSortColumn === "outcome" ? " users-th--sorted" : ""}`}
                                onClick={() => toggleAdminUsersLogSort("outcome")}
                              >
                                Outcome<span className="users-sort-icon">{sortIcon(adminUsersLogSortColumn === "outcome", adminUsersLogSortDirection)}</span>
                              </th>
                              <th
                                className={`users-th${adminUsersLogSortColumn === "user" ? " users-th--sorted" : ""}`}
                                onClick={() => toggleAdminUsersLogSort("user")}
                              >
                                User<span className="users-sort-icon">{sortIcon(adminUsersLogSortColumn === "user", adminUsersLogSortDirection)}</span>
                              </th>
                              <th
                                className={`users-th${adminUsersLogSortColumn === "ip" ? " users-th--sorted" : ""}`}
                                onClick={() => toggleAdminUsersLogSort("ip")}
                              >
                                IP Address<span className="users-sort-icon">{sortIcon(adminUsersLogSortColumn === "ip", adminUsersLogSortDirection)}</span>
                              </th>
                              <th
                                className={`users-th${adminUsersLogSortColumn === "reason" ? " users-th--sorted" : ""}`}
                                onClick={() => toggleAdminUsersLogSort("reason")}
                              >
                                Reason<span className="users-sort-icon">{sortIcon(adminUsersLogSortColumn === "reason", adminUsersLogSortDirection)}</span>
                              </th>
                              <th
                                className={`users-th${adminUsersLogSortColumn === "message" ? " users-th--sorted" : ""}`}
                                onClick={() => toggleAdminUsersLogSort("message")}
                              >
                                Message<span className="users-sort-icon">{sortIcon(adminUsersLogSortColumn === "message", adminUsersLogSortDirection)}</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedAuthAuditEntries.slice(0, 250).map((entry) => (
                              <tr key={entry.id}>
                                <td className="users-td users-td--muted" style={{ whiteSpace: "nowrap" }}>{formatPostgresTimestampMs(entry.timestampMs)}</td>
                                <td className="users-td">{entry.event.replace(/^postgres\.auth\./, "")}</td>
                                <td className="users-td">
                                  <span className={`ping-badge ${entry.outcome === "success" ? "ping-badge--ok" : entry.outcome === "attempt" || entry.outcome === "skipped" ? "ping-badge--idle" : "ping-badge--error"}`}>
                                    {entry.outcome || "-"}
                                  </span>
                                </td>
                                <td className="users-td">
                                  <div>{entry.username || entry.userId || "-"}</div>
                                  {entry.authKind || entry.role ? (
                                    <div className="users-td--muted">{[entry.authKind, entry.role].filter(Boolean).join(" / ")}</div>
                                  ) : null}
                                </td>
                                <td className="users-td users-td--muted">{entry.clientIp || "-"}</td>
                                <td className="users-td users-td--muted">{entry.reason || "-"}</td>
                                <td className="users-td">{entry.message || "-"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  ) : projectAuditEntries.length === 0 ? (
                    <div className="empty-state empty-state--compact">
                      <p>No project activity yet.</p>
                    </div>
                  ) : (
                      <div className="users-table-wrap postgres-users-table-wrap" style={{ maxHeight: 520 }}>
                        <table className="users-table" style={{ tableLayout: "auto", width: "100%" }}>
                          <thead>
                            <tr>
                            <th
                              className={`users-th${adminProjectsLogSortColumn === "time" ? " users-th--sorted" : ""}`}
                              style={{ whiteSpace: "nowrap" }}
                              onClick={() => toggleAdminProjectsLogSort("time")}
                            >
                              Time<span className="users-sort-icon">{sortIcon(adminProjectsLogSortColumn === "time", adminProjectsLogSortDirection)}</span>
                            </th>
                            <th
                              className={`users-th${adminProjectsLogSortColumn === "project" ? " users-th--sorted" : ""}`}
                              onClick={() => toggleAdminProjectsLogSort("project")}
                            >
                              Project<span className="users-sort-icon">{sortIcon(adminProjectsLogSortColumn === "project", adminProjectsLogSortDirection)}</span>
                            </th>
                            <th
                              className={`users-th${adminProjectsLogSortColumn === "user" ? " users-th--sorted" : ""}`}
                              onClick={() => toggleAdminProjectsLogSort("user")}
                            >
                              User<span className="users-sort-icon">{sortIcon(adminProjectsLogSortColumn === "user", adminProjectsLogSortDirection)}</span>
                            </th>
                            <th
                              className={`users-th${adminProjectsLogSortColumn === "action" ? " users-th--sorted" : ""}`}
                              onClick={() => toggleAdminProjectsLogSort("action")}
                            >
                              Action<span className="users-sort-icon">{sortIcon(adminProjectsLogSortColumn === "action", adminProjectsLogSortDirection)}</span>
                            </th>
                            <th
                              className={`users-th${adminProjectsLogSortColumn === "description" ? " users-th--sorted" : ""}`}
                              onClick={() => toggleAdminProjectsLogSort("description")}
                            >
                              Description<span className="users-sort-icon">{sortIcon(adminProjectsLogSortColumn === "description", adminProjectsLogSortDirection)}</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedProjectAuditEntries.slice(0, 500).map((entry) => (
                            <tr key={`${entry.projectId}:${entry.id}`}>
                              <td className="users-td users-td--muted" style={{ whiteSpace: "nowrap" }}>{formatPostgresDateTime(entry.occurredAt)}</td>
                              <td className="users-td">{entry.projectName || entry.projectId}</td>
                              <td className="users-td">{entry.userName || entry.userId || "-"}</td>
                              <td className="users-td">
                                <span className={`log-badge log-badge--${projectLogActionCategory(entry.action)}`}>
                                  {projectLogActionLabel(entry.action, t)}
                                </span>
                              </td>
                              <td className="users-td">{entry.label || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {adminAuditTab === "auth" && authAuditEntries.length > 250 ? (
                    <p className="auth-hint">Showing the 250 newest authentication events.</p>
                  ) : null}
                  {adminAuditTab === "projects" && projectAuditEntries.length > 500 ? (
                    <p className="auth-hint">Showing the 500 newest project activity events.</p>
                  ) : null}
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

      {activeModal === "administratorLog" && adminLogFilterOpen ? (
        <SettingsModal title={`Filter ${adminAuditTab === "auth" ? "Users" : "Projects"} Log`} onClose={() => setAdminLogFilterOpen(false)}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-body">
                    {adminAuditTab === "auth" ? (
                      <div className="settings-form-grid">
                        {([
                          ["time", "Time"],
                          ["event", "Event"],
                          ["outcome", "Outcome"],
                          ["user", "User"],
                          ["ip", "IP Address"],
                          ["reason", "Reason"],
                          ["message", "Message"],
                        ] as Array<[AdminUsersLogSortColumn, string]>).map(([column, label]) => (
                          <label className="form-field" key={column}>
                            <span>{label}</span>
                            <input
                              className="form-input"
                              value={adminUsersLogFilters[column]}
                              onChange={(event) => setAdminUsersLogFilters((current) => ({ ...current, [column]: event.target.value }))}
                              placeholder={`Filter ${label.toLowerCase()}`}
                            />
                          </label>
                        ))}
                      </div>
                    ) : (
                      <div className="settings-form-grid">
                        {([
                          ["time", "Time"],
                          ["project", "Project"],
                          ["user", "User"],
                          ["action", "Action"],
                          ["description", "Description"],
                        ] as Array<[AdminProjectsLogSortColumn, string]>).map(([column, label]) => (
                          <label className="form-field" key={column}>
                            <span>{label}</span>
                            <input
                              className="form-input"
                              value={adminProjectsLogFilters[column]}
                              onChange={(event) => setAdminProjectsLogFilters((current) => ({ ...current, [column]: event.target.value }))}
                              placeholder={`Filter ${label.toLowerCase()}`}
                            />
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (adminAuditTab === "auth") {
                    setAdminUsersLogFilters({
                      time: "",
                      event: "",
                      outcome: "",
                      user: "",
                      ip: "",
                      reason: "",
                      message: "",
                    });
                  } else {
                    setAdminProjectsLogFilters({
                      time: "",
                      project: "",
                      user: "",
                      action: "",
                      description: "",
                    });
                  }
                }}
              >
                Clear
              </button>
              <button type="button" className="btn btn--primary" onClick={() => setAdminLogFilterOpen(false)}>Done</button>
            </div>
        </SettingsModal>
      ) : null}

      {activeModal === "permissions" ? (
        <SettingsModal title={t("appSettings.permissions.title")} onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <SettingsModalSection title={t("appSettings.permissions.roleMatrixTitle")}>
                  <div className="permission-matrix">
                    <p className="permission-matrix-intro">{t("appSettings.permissions.roleMatrixIntro")}</p>
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
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button type="button" className="btn btn--primary" onClick={() => setActiveModal(null)}>Done</button>
            </div>
        </SettingsModal>
      ) : null}

      {activeModal === "addProject" ? (
        <SettingsModal
          title="Add Project"
          onClose={() => {
            resetAddProjectModal();
            setActiveModal(null);
          }}
          closeDisabled={creatingProject}
        >
            <form id="postgres-admin-add-project-form" className="app-settings-modal-body" onSubmit={handleCreatePostgresProject}>
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default" style={{ alignItems: "center" }}>
                    <div className="segmented-control modal-segmented-control">
                      <button
                        type="button"
                        className={addProjectTab === "details" ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                        onClick={() => setAddProjectTab("details")}
                      >
                        Details
                      </button>
                      <button
                        type="button"
                        className={addProjectTab === "members" ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                        onClick={() => setAddProjectTab("members")}
                      >
                        Members
                      </button>
                    </div>
                  </div>
                  <div className="app-settings-modal-section-body">
                    {addProjectTab === "details" ? (
                      <div className="settings-grid settings-grid--two">
                        <label className="form-label">
                          Project name
                          <input
                            className="form-input"
                            type="text"
                            value={addProjectName}
                            onChange={(event) => setAddProjectName(event.target.value)}
                            disabled={creatingProject || authSession.authKind !== "postgres_admin"}
                            autoFocus
                          />
                        </label>
                        <span />
                        <label className="form-label" style={{ gridColumn: "1 / -1", marginTop: 8 }}>
                          Description
                          <textarea
                            className="form-input form-textarea"
                            value={addProjectDescription}
                            onChange={(event) => setAddProjectDescription(event.target.value)}
                            disabled={creatingProject || authSession.authKind !== "postgres_admin"}
                            rows={4}
                          />
                        </label>
                      </div>
                    ) : (
                      <>
                        {appUsers.filter((user) => user.active).length ? (
                          <div className="users-table-wrap postgres-users-table-wrap" style={{ maxHeight: 360 }}>
                            <table className="users-table">
                              <thead>
                                <tr>
                                  <th className="users-th">User</th>
                                  <th className="users-th">Username</th>
                                  <th className="users-th">Role</th>
                                </tr>
                              </thead>
                              <tbody>
                                {appUsers
                                  .filter((user) => user.active)
                                  .map((user) => (
                                    <tr key={user.id} className="users-row">
                                      <td className="users-td users-td--name">{user.name}</td>
                                      <td className="users-td users-td--muted">{user.username}</td>
                                      <td className="users-td">
                                        <select
                                          className="form-input"
                                          value={addProjectUserRoles[user.id] ?? ""}
                                          onChange={(event) => setAddProjectUserRole(user.id, event.target.value)}
                                          disabled={creatingProject || authSession.authKind !== "postgres_admin"}
                                        >
                                          <option value="">No access</option>
                                          <option value="owner">Owner</option>
                                          <option value="editor">Editor</option>
                                          <option value="coder">Coder</option>
                                          <option value="viewer">Viewer</option>
                                        </select>
                                      </td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="auth-hint">Create users before assigning project members.</p>
                        )}
                      </>
                    )}
                    {authSession.authKind !== "postgres_admin" ? (
                      <p className="auth-hint" style={{ marginTop: 12 }}>
                        Sign in as the PostgreSQL administrator to create projects.
                      </p>
                    ) : null}
                  </div>
                </section>
              </div>
            </form>
            <div className="app-settings-modal-footer">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  resetAddProjectModal();
                  setActiveModal(null);
                }}
                disabled={creatingProject}
              >
                Cancel
              </button>
              <div className="form-actions" style={{ margin: 0 }}>
                {addProjectTab === "details" ? (
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => setAddProjectTab("members")}
                    disabled={creatingProject || authSession.authKind !== "postgres_admin" || !addProjectName.trim()}
                  >
                    Next
                  </button>
                ) : (
                  <button
                    type="submit"
                    form="postgres-admin-add-project-form"
                    className="btn btn--primary"
                    disabled={creatingProject || authSession.authKind !== "postgres_admin" || !addProjectName.trim()}
                  >
                    {creatingProject ? "Creating..." : "Create"}
                  </button>
                )}
              </div>
            </div>
        </SettingsModal>
      ) : null}

      {activeModal === "manageProjects" ? (
        <SettingsModal title="Manage Projects" onClose={() => setActiveModal(null)}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-body">
                    {authSession.authKind !== "postgres_admin" ? (
                      <p className="auth-hint">
                        Sign in as the PostgreSQL administrator to manage projects.
                      </p>
                    ) : null}
                    <div className="users-table-wrap postgres-users-table-wrap" style={{ maxHeight: 520, width: "fit-content", maxWidth: "100%", margin: "0 auto" }}>
                      <table className="users-table" style={{ tableLayout: "auto", width: "max-content", minWidth: 0 }}>
                        <thead>
                          <tr>
                            <th className="users-th">Project</th>
                            <th className="users-th" style={{ width: "1%", whiteSpace: "nowrap" }}>Status</th>
                            <th className="users-th" style={{ width: "1%", whiteSpace: "nowrap" }}>Created</th>
                            <th className="users-th" style={{ width: "1%", whiteSpace: "nowrap" }}>Last Updated</th>
                            <th className="users-th" style={{ width: "1%", whiteSpace: "nowrap" }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {projects.length ? projects.map((project) => {
                            return (
                              <tr
                                key={project.id}
                                className="users-row"
                                onPointerDown={(event) => {
                                  if (event.button !== 2) return;
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setManageProjectMenu({
                                    projectId: project.id,
                                    x: event.clientX,
                                    y: event.clientY,
                                  });
                                }}
                                onContextMenu={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setManageProjectMenu({
                                    projectId: project.id,
                                    x: event.clientX,
                                    y: event.clientY,
                                  });
                                }}
                                title="Right-click for project actions"
                                style={{ cursor: "context-menu" }}
                              >
                                <td className="users-td users-td--name">
                                  <div>{project.name}</div>
                                </td>
                                <td className="users-td" style={{ whiteSpace: "nowrap" }}>
                                  <div>{project.active ? "Active" : "Disabled"}</div>
                                  {!project.active && project.disabledAt ? (
                                    <div className="users-td--muted">{formatPostgresDateTime(project.disabledAt)}</div>
                                  ) : null}
                                </td>
                                <td className="users-td users-td--muted" style={{ whiteSpace: "nowrap" }}>{formatPostgresDateTime(project.createdAt)}</td>
                                <td className="users-td users-td--muted" style={{ whiteSpace: "nowrap" }}>{formatPostgresDateTime(project.updatedAt)}</td>
                                <td className="users-td snapshot-table-actions">
                                  <button
                                    type="button"
                                    className="snapshot-actions-trigger"
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      const rect = event.currentTarget.getBoundingClientRect();
                                      setManageUserMenu(null);
                                      setManageProjectMenu((current) => current?.projectId === project.id ? null : {
                                        projectId: project.id,
                                        x: Math.max(8, rect.right - 160),
                                        y: rect.bottom + 4,
                                      });
                                    }}
                                    aria-label={`Actions for ${project.name}`}
                                    aria-expanded={manageProjectMenu?.projectId === project.id}
                                    title="Project actions"
                                  >
                                    ...
                                  </button>
                                </td>
                              </tr>
                            );
                          }) : (
                            <tr>
                              <td className="users-td users-td--muted" colSpan={5}>No PostgreSQL projects have been created yet.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
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

      {activeModal === "manageProjects" && manageProjectMenu && manageProjectMenuProject ? (
        <div
          className="context-menu"
          style={{ left: manageProjectMenu.x, top: manageProjectMenu.y, minWidth: 160, zIndex: 1500 }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className={!manageProjectMenuProject.active || !onOpenProject ? "context-menu-item context-menu-item--disabled" : "context-menu-item"}
            disabled={!manageProjectMenuProject.active || !onOpenProject || openingProjectId === manageProjectMenuProject.id}
            onClick={() => {
              setManageProjectMenu(null);
              void handleOpenManagedProject(manageProjectMenuProject);
            }}
          >
            {openingProjectId === manageProjectMenuProject.id ? "Opening..." : "Open"}
          </button>
          <button
            type="button"
            className={
              authSession.authKind !== "postgres_admin"
                ? "context-menu-item context-menu-item--disabled"
                : manageProjectMenuProject.active
                  ? "context-menu-item context-menu-item--danger"
                  : "context-menu-item"
            }
            disabled={
              authSession.authKind !== "postgres_admin" ||
              updatingProjectStatusId === manageProjectMenuProject.id ||
              deletingProjectId === manageProjectMenuProject.id
            }
            onClick={() => {
              setManageProjectMenu(null);
              setProjectAccessWarning({
                action: manageProjectMenuProject.active ? "disable" : "enable",
                project: manageProjectMenuProject,
              });
            }}
          >
            {updatingProjectStatusId === manageProjectMenuProject.id
              ? manageProjectMenuProject.active ? "Disabling..." : "Enabling..."
              : manageProjectMenuProject.active ? "Disable" : "Enable"}
          </button>
          <button
            type="button"
            className={authSession.authKind !== "postgres_admin" ? "context-menu-item context-menu-item--disabled" : "context-menu-item context-menu-item--danger"}
            disabled={
              authSession.authKind !== "postgres_admin" ||
              updatingProjectStatusId === manageProjectMenuProject.id ||
              deletingProjectId === manageProjectMenuProject.id
            }
            onClick={() => {
              setManageProjectMenu(null);
              setProjectAccessWarning({ action: "delete", project: manageProjectMenuProject });
            }}
          >
            {deletingProjectId === manageProjectMenuProject.id ? "Deleting..." : "Delete"}
          </button>
        </div>
      ) : null}

      {activeModal === "addUser" ? (
        <SettingsModal
          title="Add User"
          onClose={() => {
            resetAddUserModal();
            setActiveModal(null);
          }}
          closeDisabled={creatingUser}
        >
            <form id="postgres-admin-add-user-form" className="app-settings-modal-body" onSubmit={handleCreatePostgresUser}>
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default" style={{ alignItems: "center" }}>
                    <div className="segmented-control modal-segmented-control">
                      <button
                        type="button"
                        className={addUserTab === "account" ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                        onClick={() => setAddUserTab("account")}
                      >
                        Account
                      </button>
                      <button
                        type="button"
                        className={addUserTab === "projects" ? "segmented-control-option segmented-control-option--active" : "segmented-control-option"}
                        onClick={() => setAddUserTab("projects")}
                      >
                        Projects
                      </button>
                    </div>
                  </div>
                  <div className="app-settings-modal-section-body">
                    {addUserTab === "account" ? (
                      <div className="settings-grid settings-grid--two">
                        <label className="form-label">
                          Username
                          <input
                            className="form-input"
                            type="text"
                            value={addUserUsername}
                            onChange={(event) => setAddUserUsername(event.target.value)}
                            autoComplete="username"
                            disabled={creatingUser || authSession.authKind !== "postgres_admin"}
                            autoFocus
                          />
                        </label>
                        <span />
                        <label className="form-label" style={{ marginTop: 8 }}>
                          Temporary Password
                          <div className="password-input-wrap">
                            <input
                              className="form-input password-input-field"
                              type={addUserPasswordVisible ? "text" : "password"}
                              value={addUserPassword}
                              onChange={(event) => setAddUserPassword(event.target.value)}
                              autoComplete="new-password"
                              disabled={creatingUser || authSession.authKind !== "postgres_admin"}
                            />
                            <button
                              type="button"
                              className="password-visibility-btn"
                              aria-label={addUserPasswordVisible ? "Hide password" : "Show password"}
                              aria-pressed={addUserPasswordVisible}
                              onClick={() => setAddUserPasswordVisible((current) => !current)}
                              disabled={creatingUser || authSession.authKind !== "postgres_admin"}
                            >
                              <PasswordVisibilityIcon />
                            </button>
                          </div>
                          <p className="password-requirement-note">Minimum 8 characters.</p>
                        </label>
                        <label className="form-label" style={{ marginTop: 8 }}>
                          Confirm password
                          <div className="password-input-wrap">
                            <input
                              className="form-input password-input-field"
                              type={addUserPasswordConfirmVisible ? "text" : "password"}
                              value={addUserPasswordConfirm}
                              onChange={(event) => setAddUserPasswordConfirm(event.target.value)}
                              autoComplete="new-password"
                              disabled={creatingUser || authSession.authKind !== "postgres_admin"}
                            />
                            <button
                              type="button"
                              className="password-visibility-btn"
                              aria-label={addUserPasswordConfirmVisible ? "Hide password" : "Show password"}
                              aria-pressed={addUserPasswordConfirmVisible}
                              onClick={() => setAddUserPasswordConfirmVisible((current) => !current)}
                              disabled={creatingUser || authSession.authKind !== "postgres_admin"}
                            >
                              <PasswordVisibilityIcon />
                            </button>
                          </div>
                        </label>
                        {addUserPasswordMismatch ? (
                          <p className="settings-warning settings-warning--danger" style={{ gridColumn: "1 / -1", margin: 0 }}>
                            The password entries do not match.
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <>
                        {projects.length ? (
                          <div className="users-table-wrap postgres-users-table-wrap" style={{ maxHeight: 360 }}>
                            <table className="users-table">
                              <thead>
                                <tr>
                                  <th className="users-th">Project</th>
                                  <th className="users-th">Database</th>
                                  <th className="users-th">Role</th>
                                </tr>
                              </thead>
                              <tbody>
                                {projects.map((project) => (
                                  <tr key={project.id} className="users-row">
                                    <td className="users-td users-td--name">{project.name}</td>
                                    <td className="users-td users-td--muted">{project.databaseName}</td>
                                    <td className="users-td">
                                      <select
                                        className="form-input"
                                        value={addUserProjectRoles[project.id] ?? ""}
                                        onChange={(event) => setAddUserProjectRole(project.id, event.target.value)}
                                        disabled={creatingUser || authSession.authKind !== "postgres_admin"}
                                      >
                                        <option value="">No access</option>
                                        <option value="owner">Owner</option>
                                        <option value="editor">Editor</option>
                                        <option value="coder">Coder</option>
                                        <option value="viewer">Viewer</option>
                                      </select>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="auth-hint">Create a project before assigning project roles.</p>
                        )}
                      </>
                    )}
                    {authSession.authKind !== "postgres_admin" ? (
                      <p className="auth-hint" style={{ marginTop: 12 }}>
                        Sign in as the PostgreSQL administrator to create database-backed users.
                      </p>
                    ) : null}
                  </div>
                </section>
              </div>
            </form>
            <div className="app-settings-modal-footer">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  resetAddUserModal();
                  setActiveModal(null);
                }}
                disabled={creatingUser}
              >
                Cancel
              </button>
              <div className="form-actions" style={{ margin: 0 }}>
                {addUserTab === "account" ? (
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => setAddUserTab("projects")}
                    disabled={creatingUser || authSession.authKind !== "postgres_admin" || addUserPasswordMismatch}
                  >
                    Next
                  </button>
                ) : (
                  <button
                    type="submit"
                    form="postgres-admin-add-user-form"
                    className="btn btn--primary"
                    disabled={creatingUser || authSession.authKind !== "postgres_admin" || addUserPasswordMismatch}
                  >
                    {creatingUser ? "Creating..." : "Create"}
                  </button>
                )}
              </div>
            </div>
        </SettingsModal>
      ) : null}

      {activeModal === "manageUsers" ? (
        <SettingsModal
          title="Manage Users"
          onClose={() => {
            setMembershipUser(null);
            setManageUserMenu(null);
            setActiveModal(null);
          }}
        >
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-body">
                    {authSession.authKind !== "postgres_admin" ? (
                      <p className="auth-hint">
                        Sign in as the PostgreSQL administrator to manage database-backed users.
                      </p>
                    ) : null}
                    <div className="users-table-wrap postgres-users-table-wrap" style={{ maxHeight: 520 }}>
                      <table className="users-table" style={{ tableLayout: "auto", width: "100%" }}>
                        <thead>
                          <tr>
                            <th className="users-th">User</th>
                            <th className="users-th" style={{ width: "1%", whiteSpace: "nowrap" }}>Status</th>
                            <th className="users-th" style={{ width: "1%", whiteSpace: "nowrap" }}>Login</th>
                            <th className="users-th" style={{ width: "1%", whiteSpace: "nowrap" }}>Created</th>
                            <th className="users-th" style={{ width: "1%", whiteSpace: "nowrap" }}>Last Active</th>
                            <th className="users-th" style={{ width: "1%", whiteSpace: "nowrap" }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {appUsers.length ? appUsers.map((user) => {
                            return (
                              <tr
                                key={user.id}
                                className="users-row"
                                onPointerDown={(event) => {
                                  if (event.button !== 2) return;
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setManageUserMenu({
                                    userId: user.id,
                                    x: event.clientX,
                                    y: event.clientY,
                                  });
                                }}
                                onContextMenu={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setManageUserMenu({
                                    userId: user.id,
                                    x: event.clientX,
                                    y: event.clientY,
                                  });
                                }}
                                title="Right-click for user actions"
                                style={{ cursor: "context-menu" }}
                              >
                                <td className="users-td users-td--name">
                                  <div>{user.name}</div>
                                  <div className="users-td--muted">{user.username}</div>
                                </td>
                                <td className="users-td" style={{ whiteSpace: "nowrap" }}>
                                  <div>{user.active ? "Active" : "Disabled"}</div>
                                  {user.mustChangePassword ? (
                                    <div className="users-td--muted">Password reset required</div>
                                  ) : null}
                                </td>
                                <td className="users-td" style={{ whiteSpace: "nowrap" }}>
                                  <div>{postgresUserLoginAccessLabel(user)}</div>
                                  {user.loginBlockedUntilMs && user.loginBlockedUntilMs > Date.now() ? (
                                    <div className="users-td--muted">Until {formatPostgresTimestampMs(user.loginBlockedUntilMs)}</div>
                                  ) : user.loginFailedAttemptsLastHour > 0 ? (
                                    <div className="users-td--muted">{user.loginFailedAttemptsLastHour} failed in last hour</div>
                                  ) : null}
                                </td>
                                <td className="users-td users-td--muted" style={{ whiteSpace: "nowrap" }}>{formatPostgresDateTime(user.createdAt)}</td>
                                <td className="users-td users-td--muted" style={{ whiteSpace: "nowrap" }}>{user.lastLoginAt ? formatPostgresDateTime(user.lastLoginAt) : "-"}</td>
                                <td className="users-td snapshot-table-actions">
                                  <button
                                    type="button"
                                    className="snapshot-actions-trigger"
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      const rect = event.currentTarget.getBoundingClientRect();
                                      setManageProjectMenu(null);
                                      setManageUserMenu((current) => current?.userId === user.id ? null : {
                                        userId: user.id,
                                        x: Math.max(8, rect.right - 190),
                                        y: rect.bottom + 4,
                                      });
                                    }}
                                    aria-label={`Actions for ${user.username}`}
                                    aria-expanded={manageUserMenu?.userId === user.id}
                                    title="User actions"
                                  >
                                    ...
                                  </button>
                                </td>
                              </tr>
                            );
                          }) : (
                            <tr>
                              <td className="users-td users-td--muted" colSpan={6}>No PostgreSQL app users have been created yet.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  setMembershipUser(null);
                  setManageUserMenu(null);
                  setActiveModal(null);
                }}
              >
                Done
              </button>
            </div>
        </SettingsModal>
      ) : null}

      {activeModal === "manageUsers" && manageUserMenu && manageUserMenuUser ? (
        <div
          className="context-menu"
          style={{ left: manageUserMenu.x, top: manageUserMenu.y, minWidth: 190, zIndex: 1500 }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className={authSession.authKind !== "postgres_admin" ? "context-menu-item context-menu-item--disabled" : "context-menu-item"}
            disabled={authSession.authKind !== "postgres_admin" || deactivatingUserId === manageUserMenuUser.id}
            onClick={() => {
              setManageUserMenu(null);
              setResetPasswordUser(manageUserMenuUser);
              setResetPasswordValue("");
              setResetPasswordConfirmValue("");
              setResetPasswordVisible(false);
              setResetPasswordConfirmVisible(false);
              setError("");
            }}
          >
            {postgresUserIsLoginBlocked(manageUserMenuUser) ? "Reset + Unblock" : "Reset Password"}
          </button>
          <button
            type="button"
            className="context-menu-item"
            onClick={() => handleInspectUserLoginAttempts(manageUserMenuUser)}
          >
            Inspect Login Attempts
          </button>
          <button
            type="button"
            className={loadingProjectMemberships ? "context-menu-item context-menu-item--disabled" : "context-menu-item"}
            disabled={loadingProjectMemberships}
            onClick={() => {
              setManageUserMenu(null);
              setMembershipNotice("");
              setMembershipError("");
              setMembershipUser(manageUserMenuUser);
            }}
          >
            {loadingProjectMemberships
              ? "Loading memberships..."
              : `View Memberships (${(membershipsByAppUserId[manageUserMenuUser.id] ?? []).length})`}
          </button>
          <button
            type="button"
            className={
              authSession.authKind !== "postgres_admin"
                ? "context-menu-item context-menu-item--disabled"
                : manageUserMenuUser.active
                  ? "context-menu-item context-menu-item--danger"
                  : "context-menu-item"
            }
            disabled={
              authSession.authKind !== "postgres_admin" ||
              deactivatingUserId === manageUserMenuUser.id ||
              reactivatingUserId === manageUserMenuUser.id
            }
            onClick={() => {
              setManageUserMenu(null);
              setUserAccessWarning({ action: manageUserMenuUser.active ? "disable" : "enable", user: manageUserMenuUser });
            }}
          >
            {deactivatingUserId === manageUserMenuUser.id
              ? "Disabling..."
              : reactivatingUserId === manageUserMenuUser.id
                ? "Enabling..."
                : manageUserMenuUser.active
                  ? "Disable"
                  : "Enable"}
          </button>
        </div>
      ) : null}

      {activeModal === "manageUsers" && membershipUser ? (
        <SettingsModal title={membershipUser.username} onClose={closeMembershipModal}>
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-body">
                    {(() => {
                      const memberships = (membershipsByAppUserId[membershipUser.id] ?? [])
                        .slice()
                        .sort((a, b) => {
                          const projectA = projectById.get(a.projectId)?.name ?? "";
                          const projectB = projectById.get(b.projectId)?.name ?? "";
                          return projectA.localeCompare(projectB) || a.role.localeCompare(b.role);
                        });
                      const membershipProjectIds = new Set(memberships.map((membership) => membership.projectId));
                      const availableProjects = projects
                        .filter((project) => !membershipProjectIds.has(project.id))
                        .slice()
                        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
                      return (
                        <div className="admin-membership-lists">
                          <div className="admin-membership-list">
                            <h3 className="admin-membership-list-title">Project Memberships</h3>
                            {memberships.length ? (
                              <div className="users-table-wrap postgres-users-table-wrap admin-membership-table-wrap">
                                <table className="users-table">
                                  <thead>
                                    <tr>
                                      <th className="users-th">Project</th>
                                      <th className="users-th">Role</th>
                                      <th className="users-th admin-membership-icon-th" aria-label="Remove" />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {memberships.map((membership) => {
                                      const membershipProject = projectById.get(membership.projectId);
                                      const membershipBusy =
                                        updatingMembershipId === membership.id ||
                                        removingMembershipId === membership.id;
                                      return (
                                        <tr key={membership.id} className="users-row">
                                          <td className="users-td users-td--name">
                                            <div>{membershipProject?.name ?? membership.projectId}</div>
                                            <div className="users-td--muted">{membershipProject?.databaseName ?? ""}</div>
                                          </td>
                                          <td className="users-td">
                                            <select
                                              className="form-input"
                                              value={membership.role}
                                              onChange={(event) => void handleUpdateProjectMembershipRole(membership, event.target.value)}
                                              disabled={authSession.authKind !== "postgres_admin" || membershipBusy}
                                            >
                                              <option value="owner">Owner</option>
                                              <option value="editor">Editor</option>
                                              <option value="coder">Coder</option>
                                              <option value="viewer">Viewer</option>
                                            </select>
                                          </td>
                                          <td className="users-td admin-membership-icon-cell">
                                            <button
                                              type="button"
                                              className="admin-membership-icon-button admin-membership-icon-button--remove"
                                              aria-label={`Remove ${membershipUser.username} from ${membershipProject?.name ?? "project"}`}
                                              title={removingMembershipId === membership.id ? "Removing" : "Remove"}
                                              onClick={() => void handleRemoveProjectMembership(membership)}
                                              disabled={authSession.authKind !== "postgres_admin" || membershipBusy}
                                            >
                                              <CloseIcon className="admin-membership-icon" />
                                            </button>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <p className="auth-hint">No project memberships.</p>
                            )}
                          </div>

                          <div className="admin-membership-list">
                            <h3 className="admin-membership-list-title">Available Projects</h3>
                            {availableProjects.length ? (
                              <div className="users-table-wrap postgres-users-table-wrap admin-membership-table-wrap">
                                <table className="users-table">
                                  <thead>
                                    <tr>
                                      <th className="users-th">Project</th>
                                      <th className="users-th">Status</th>
                                      <th className="users-th admin-membership-icon-th" aria-label="Add" />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {availableProjects.map((project) => {
                                      const adding = addingMembershipProjectId === project.id;
                                      return (
                                        <tr key={project.id} className="users-row">
                                          <td className="users-td users-td--name">
                                            <div>{project.name}</div>
                                            <div className="users-td--muted">{project.databaseName}</div>
                                          </td>
                                          <td className="users-td">{project.active ? "Active" : "Disabled"}</td>
                                          <td className="users-td admin-membership-icon-cell">
                                            <button
                                              type="button"
                                              className="admin-membership-icon-button admin-membership-icon-button--add"
                                              aria-label={`Add ${membershipUser.username} to ${project.name}`}
                                              title={adding ? "Adding" : "Add as viewer"}
                                              onClick={() => void handleAddProjectMembership(membershipUser, project)}
                                              disabled={authSession.authKind !== "postgres_admin" || adding || Boolean(addingMembershipProjectId)}
                                            >
                                              <CheckIcon className="admin-membership-icon" />
                                            </button>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <p className="auth-hint">No available projects.</p>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </section>
              </div>
            </div>
            <div className="app-settings-modal-footer">
              <span />
              <button type="button" className="btn btn--primary" onClick={closeMembershipModal}>Done</button>
            </div>
        </SettingsModal>
      ) : null}

      {activeModal === "administration" ? (
        <SettingsModal
          title={t("appSettings.admin.title")}
          onClose={() => setActiveModal(null)}
          subtitle={(
            <button type="button" className="btn" onClick={() => void refreshPostgresDetails()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          )}
        >
            <div className="app-settings-modal-body">
              <div className="app-settings-modal-sections">
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default"><h3>Current Session</h3></div>
                  <div className="app-settings-modal-section-body">
                    <div className="home-restricted-list">
                      <div className="home-restricted-item"><span className="home-restricted-label">Signed in as</span><span className="home-restricted-value">{authSession.user.name}</span></div>
                      <div className="home-restricted-item"><span className="home-restricted-label">Role</span><span className="home-restricted-value">{authSession.authKind === "postgres_admin" ? "Local administrator" : authSession.user.role}</span></div>
                      <div className="home-restricted-item"><span className="home-restricted-label">Session started</span><span className="home-restricted-value">{formatPostgresDateTime(new Date(authSession.startedAtMs).toISOString())}</span></div>
                    </div>
                  </div>
                </section>
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default"><h3>Local PostgreSQL</h3></div>
                  <div className="app-settings-modal-section-body">
                    <div className="home-restricted-list">
                      <div className="home-restricted-item"><span className="home-restricted-label">Host</span><span className="home-restricted-value">{status ? `${status.host}:${status.port}` : "-"}</span></div>
                      <div className="home-restricted-item"><span className="home-restricted-label">Bundled database reachable</span><span className="home-restricted-value">{status?.serviceReachable ? "Yes" : "No"}</span></div>
                      <div className="home-restricted-item"><span className="home-restricted-label">Control database ready</span><span className="home-restricted-value">{status?.bootstrapApplied ? "Yes" : "No"}</span></div>
                      <div className="home-restricted-item"><span className="home-restricted-label">Setup finalized</span><span className="home-restricted-value">{status?.adminHandoffCompleted ? "Yes" : "No"}</span></div>
                      <div className="home-restricted-item"><span className="home-restricted-label">Database account</span><span className="home-restricted-value">{databaseAccountStatus}</span></div>
                    </div>
                  </div>
                </section>
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default"><h3>User Accounts</h3></div>
                  <div className="app-settings-modal-section-body">
                    {authSession.authKind !== "postgres_admin" ? (
                      <p className="auth-hint">
                        Sign in as the PostgreSQL administrator to create database-backed users.
                      </p>
                    ) : null}
                    <div className="users-table-wrap postgres-users-table-wrap" style={{ maxHeight: 320 }}>
                      <table className="users-table">
                        <thead>
                          <tr>
                            <th className="users-th">Name</th>
                            <th className="users-th">Username</th>
                            <th className="users-th">Role</th>
                            <th className="users-th">Status</th>
                            <th className="users-th">Updated</th>
                            <th className="users-th">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {appUsers.length ? appUsers.map((user) => (
                            <tr key={user.id} className="users-row">
                              <td className="users-td users-td--name">{user.name}</td>
                              <td className="users-td users-td--muted">{user.username}</td>
                              <td className="users-td">{user.role}</td>
                              <td className="users-td">{user.active ? "Active" : "Disabled"}</td>
                              <td className="users-td users-td--muted">{formatPostgresDateTime(user.updatedAt)}</td>
                              <td className="users-td">
                                <div className="form-actions" style={{ gap: 8, justifyContent: "flex-start", margin: 0 }}>
                                  <button
                                    type="button"
                                    className="btn btn--sm"
                                    disabled={
                                      authSession.authKind !== "postgres_admin" ||
                                      !user.active ||
                                      deactivatingUserId === user.id
                                    }
                                    onClick={() => {
                                      setResetPasswordUser(user);
                                      setResetPasswordValue("");
                                      setResetPasswordConfirmValue("");
                                      setResetPasswordVisible(false);
                                      setResetPasswordConfirmVisible(false);
                                      setError("");
                                    }}
                                  >
                                    Reset
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn--sm btn--primary"
                                    disabled={
                                      authSession.authKind !== "postgres_admin" ||
                                      !user.active ||
                                      deactivatingUserId === user.id
                                    }
                                    onClick={() => setUserAccessWarning({ action: "disable", user })}
                                  >
                                    {deactivatingUserId === user.id ? "Disabling..." : "Disable"}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )) : (
                            <tr>
                              <td className="users-td users-td--muted" colSpan={6}>No PostgreSQL app users have been created yet.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
                <section className="app-settings-modal-section">
                  <div className="app-settings-modal-section-header app-settings-modal-section-header--default"><h3>Workspace Summary</h3></div>
                  <div className="app-settings-modal-section-body">
                    <div className="home-restricted-list">
                      <div className="home-restricted-item"><span className="home-restricted-label">Registered users</span><span className="home-restricted-value">{authStatus?.registeredUserCount ?? "-"}</span></div>
                      <div className="home-restricted-item"><span className="home-restricted-label">Project databases</span><span className="home-restricted-value">{projects.length}</span></div>
                    </div>
                    {projects.length > 0 ? (
                      <div className="users-table-wrap postgres-users-table-wrap" style={{ marginTop: 16, maxHeight: 280 }}>
                        <table className="users-table">
                          <thead><tr><th className="users-th">Project</th><th className="users-th">Database</th><th className="users-th">Updated</th></tr></thead>
                          <tbody>
                            {projects.map((project) => (
                              <tr key={project.id} className="users-row">
                                <td className="users-td users-td--name">{project.name}</td>
                                <td className="users-td users-td--muted">{project.databaseName}</td>
                                <td className="users-td users-td--muted">{formatPostgresDateTime(project.updatedAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="auth-hint" style={{ marginTop: 12 }}>No PostgreSQL project databases have been created yet.</p>
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

      {membershipRemovalWarning ? (
        <SettingsModal
          title="Remove Project Access"
          onClose={() => setMembershipRemovalWarning(null)}
          closeDisabled={removingMembershipId === membershipRemovalWarning.id}
          modalClassName="modal--narrow"
        >
          <div className="app-settings-modal-body">
            <p className="settings-warning settings-warning--danger">
              {`This will remove ${membershipRemovalWarning.email}'s access to ${
                projectById.get(membershipRemovalWarning.projectId)?.name ?? "this project"
              }.`}
            </p>
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only membership-removal-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setMembershipRemovalWarning(null)}
                disabled={removingMembershipId === membershipRemovalWarning.id}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => void confirmRemoveProjectMembership(membershipRemovalWarning)}
                disabled={removingMembershipId === membershipRemovalWarning.id}
              >
                {removingMembershipId === membershipRemovalWarning.id ? "Removing..." : "Remove"}
              </button>
          </div>
        </SettingsModal>
      ) : null}

      {projectAccessWarning ? (
        <SettingsModal
          title={
            projectAccessWarning.action === "delete"
              ? "Delete Project"
              : projectAccessWarning.action === "disable"
                ? "Disable Project"
                : "Enable Project"
          }
          onClose={() => setProjectAccessWarning(null)}
          closeDisabled={
            updatingProjectStatusId === projectAccessWarning.project.id ||
            deletingProjectId === projectAccessWarning.project.id
          }
          modalClassName="modal--narrow"
        >
          <div className="app-settings-modal-body">
            <p className={projectAccessWarning.action === "delete" ? "settings-warning settings-warning--danger" : "settings-warning"}>
              {projectAccessWarning.action === "delete"
                ? `This will permanently delete ${projectAccessWarning.project.name}, including its PostgreSQL database and local project storage. This cannot be undone.`
                : projectAccessWarning.action === "disable"
                  ? `Users will lose access to ${projectAccessWarning.project.name} until the project is enabled again.`
                  : `Users with project memberships will regain access to ${projectAccessWarning.project.name}.`}
            </p>
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
              <button
                type="button"
                className="btn"
                onClick={() => setProjectAccessWarning(null)}
                disabled={
                  updatingProjectStatusId === projectAccessWarning.project.id ||
                  deletingProjectId === projectAccessWarning.project.id
                }
              >
                Cancel
              </button>
              <button
                type="button"
                className={projectAccessWarning.action === "delete" ? "btn btn--danger" : "btn btn--primary"}
                onClick={() => {
                  if (projectAccessWarning.action === "delete") {
                    void handleDeleteManagedProject(projectAccessWarning.project);
                    return;
                  }
                  void handleSetManagedProjectActive(
                    projectAccessWarning.project,
                    projectAccessWarning.action === "enable",
                  );
                }}
                disabled={
                  authSession.authKind !== "postgres_admin" ||
                  updatingProjectStatusId === projectAccessWarning.project.id ||
                  deletingProjectId === projectAccessWarning.project.id
                }
              >
                {projectAccessWarning.action === "delete"
                  ? deletingProjectId === projectAccessWarning.project.id ? "Deleting..." : "Delete"
                  : updatingProjectStatusId === projectAccessWarning.project.id
                    ? projectAccessWarning.action === "enable" ? "Enabling..." : "Disabling..."
                    : projectAccessWarning.action === "enable" ? "Enable" : "Disable"}
              </button>
          </div>
        </SettingsModal>
      ) : null}

      {userAccessWarning ? (
        <SettingsModal
          title={userAccessWarning.action === "disable" ? "Disable User" : "Enable User"}
          onClose={() => setUserAccessWarning(null)}
          closeDisabled={
            deactivatingUserId === userAccessWarning.user.id ||
            reactivatingUserId === userAccessWarning.user.id
          }
          modalClassName="modal--narrow"
        >
          <div className="app-settings-modal-body">
            <p className="settings-row-desc">
              {userAccessWarning.action === "disable"
                ? `${userAccessWarning.user.username} will lose access to KanQual, the PostgreSQL server, and every project.`
                : `${userAccessWarning.user.username} will regain access to the PostgreSQL server. You will need to set a temporary password before the account can be used.`}
            </p>
            <div className="form-actions" style={{ justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn"
                onClick={() => setUserAccessWarning(null)}
                disabled={
                  deactivatingUserId === userAccessWarning.user.id ||
                  reactivatingUserId === userAccessWarning.user.id
                }
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  if (userAccessWarning.action === "disable") {
                    void handleDeactivatePostgresUser(userAccessWarning.user);
                  } else {
                    void handleReactivatePostgresUser(userAccessWarning.user);
                  }
                }}
                disabled={
                  deactivatingUserId === userAccessWarning.user.id ||
                  reactivatingUserId === userAccessWarning.user.id
                }
              >
                {userAccessWarning.action === "disable"
                  ? deactivatingUserId === userAccessWarning.user.id ? "Disabling..." : "Disable"
                  : reactivatingUserId === userAccessWarning.user.id ? "Enabling..." : "Enable"}
              </button>
            </div>
          </div>
        </SettingsModal>
      ) : null}

      {confirmEnableNetworkMode ? (
        <SettingsModal
          title={pendingNetworkMode === "internet" ? "Enable Internet Mode" : t("appSettings.network.enableTitle")}
          onClose={() => {
            setConfirmEnableNetworkMode(false);
            setInternetModeConfirmation("");
          }}
          closeDisabled={networkSwitching}
          modalClassName="modal--narrow"
        >
          <div className="app-settings-modal-body">
            <p className="settings-warning settings-warning--danger">
              {pendingNetworkMode === "internet"
                ? "Internet mode can expose this KanQual server to the public Internet. KanQual does not manage TLS certificates for this mode, so database traffic may be readable unless you protect access with a VPN, encrypted tunnel, firewall, or equivalent network security. Use this only if you understand and accept that risk."
                : "Other devices on your trusted local network may be able to connect to this PostgreSQL database."}
            </p>
            {pendingNetworkMode === "internet" ? (
              <label className="form-label">
                Type ENABLE INTERNET to continue
                <input
                  className="form-input"
                  value={internetModeConfirmation}
                  onChange={(event) => setInternetModeConfirmation(event.target.value)}
                  disabled={networkSwitching}
                  autoFocus
                />
              </label>
            ) : null}
          </div>
          <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setConfirmEnableNetworkMode(false);
                  setInternetModeConfirmation("");
                }}
                disabled={networkSwitching}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => void handleConfirmPostgresNetworkMode()}
                disabled={networkSwitching || (pendingNetworkMode === "internet" && internetModeConfirmation.trim() !== "ENABLE INTERNET")}
              >
                {networkSwitching ? t("appSettings.network.enabling") : t("appSettings.network.enableAction")}
              </button>
          </div>
        </SettingsModal>
      ) : null}

      {resetPasswordUser ? (
        <SettingsModal
          title={postgresUserIsLoginBlocked(resetPasswordUser) ? "Reset + Unblock" : "Reset Password"}
          onClose={() => {
            if (!resettingPassword && requiredResetUserId !== resetPasswordUser.id) {
              setResetPasswordUser(null);
              setResetPasswordValue("");
              setResetPasswordConfirmValue("");
              setResetPasswordVisible(false);
              setResetPasswordConfirmVisible(false);
            }
          }}
          closeDisabled={resettingPassword || requiredResetUserId === resetPasswordUser.id}
          modalClassName="modal--narrow"
        >
          <div className="app-settings-modal-body">
            <p className="settings-row-desc">
              {postgresUserIsLoginBlocked(resetPasswordUser)
                ? `Set a new temporary password for ${resetPasswordUser.username}. The login block will be removed after the password is reset.`
                : requiredResetUserId === resetPasswordUser.id
                ? `Set a temporary password for ${resetPasswordUser.username} to finish enabling this account.`
                : `Set a new temporary password for ${resetPasswordUser.username}.`}
            </p>
            <form className="form" onSubmit={handleResetPostgresUserPassword}>
              <label className="form-label" style={{ marginTop: 8 }}>
                New password
                <div className="password-input-wrap">
                  <input
                    className="form-input password-input-field"
                    type={resetPasswordVisible ? "text" : "password"}
                    value={resetPasswordValue}
                    onChange={(event) => setResetPasswordValue(event.target.value)}
                    autoFocus
                    autoComplete="new-password"
                    disabled={resettingPassword}
                  />
                  <button
                    type="button"
                    className="password-visibility-btn"
                    aria-label={resetPasswordVisible ? "Hide password" : "Show password"}
                    aria-pressed={resetPasswordVisible}
                    onClick={() => setResetPasswordVisible((current) => !current)}
                    disabled={resettingPassword}
                  >
                    <PasswordVisibilityIcon />
                  </button>
                </div>
                <p className="password-requirement-note">Minimum 8 characters.</p>
              </label>
              <label className="form-label">
                Confirm password
                <div className="password-input-wrap">
                  <input
                    className="form-input password-input-field"
                    type={resetPasswordConfirmVisible ? "text" : "password"}
                    value={resetPasswordConfirmValue}
                    onChange={(event) => setResetPasswordConfirmValue(event.target.value)}
                    autoComplete="new-password"
                    disabled={resettingPassword}
                  />
                  <button
                    type="button"
                    className="password-visibility-btn"
                    aria-label={resetPasswordConfirmVisible ? "Hide password" : "Show password"}
                    aria-pressed={resetPasswordConfirmVisible}
                    onClick={() => setResetPasswordConfirmVisible((current) => !current)}
                    disabled={resettingPassword}
                  >
                    <PasswordVisibilityIcon />
                  </button>
                </div>
              </label>
              {resetPasswordConfirmValue && resetPasswordValue !== resetPasswordConfirmValue ? (
                <p className="settings-warning settings-warning--danger" style={{ margin: 0 }}>
                  The password entries do not match.
                </p>
              ) : null}
              <div className="form-actions" style={{ justifyContent: "flex-end" }}>
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={
                    resettingPassword ||
                    resetPasswordValue.length < 8 ||
                    resetPasswordValue !== resetPasswordConfirmValue
                  }
                >
                  {resettingPassword ? "Resetting..." : "Reset"}
                </button>
              </div>
            </form>
          </div>
        </SettingsModal>
      ) : null}

      {showThemeManager ? (
        <ThemeManagerModal
          onClose={() => setShowThemeManager(false)}
          onApplied={() => void handleThemeManagerApplied()}
          onCanceled={() => {
            setTheme(getStoredTheme());
          }}
        />
      ) : null}
    </div>
  );
}
