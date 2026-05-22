import { useState, useCallback, useRef } from "react";
import type { RecordModel } from "pocketbase";
import {
  type Theme,
  type ColorVar,
  type ThemePreset,
  COLOR_VARS,
  getAppDefaults,
  getStoredTheme,
  getStoredOverrides,
  saveOverrides,
  getStoredRadius,
  getStoredBorderWidth,
  getPresets,
  savePreset,
  deletePreset,
  getActivePresetId,
  resetThemeToDefaults,
  setActivePresetId,
} from "../theme";
import { invoke } from "@tauri-apps/api/core";
import { readDir, stat } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAuth } from "../context/AuthContext";
import { useStore } from "../context/StoreContext";
import {
  clearRecentProjects,
  formatBytes,
  readAppSettings,
  saveAppSettings,
  type AppSettings,
} from "../lib/appSettings";
import { clearLocalAccounts, clearRemoteSessions } from "../lib/authHistory";
import { getAppRuntimeInfo, joinFsPath, type AppRuntimeInfo } from "../lib/dataRoot";
import { clearAppDataRecords, deleteUserAccount } from "../lib/pb";
import { permissionMatrixRows, type PermissionMatrixRow } from "../lib/permissionMatrix";
import thirdPartyNoticesRaw from "../../THIRD_PARTY_NOTICES.md?raw";
import { HelpIcon } from "../components/AppIcons";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function isValidHex(val: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(val) || /^#[0-9a-fA-F]{3}$/.test(val);
}

function normalizeHex(val: string): string {
  if (/^#[0-9a-fA-F]{3}$/.test(val)) {
    const r = val[1], g = val[2], b = val[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return val.toLowerCase();
}

function currentSnapshot() {
  const base = getStoredTheme();
  return {
    base,
    colors: { ...getAppDefaults(base), ...getStoredOverrides(base) },
    radius: getStoredRadius(),
    borderWidth: getStoredBorderWidth(),
  };
}

function applyLive(
  base: Theme,
  colors: Record<string, string>,
  radius: number,
  borderWidth: number,
) {
  if (base === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  for (const v of COLOR_VARS) {
    document.documentElement.style.removeProperty(v.key);
  }
  for (const [k, v] of Object.entries(colors)) {
    document.documentElement.style.setProperty(k, v);
  }
  document.documentElement.style.setProperty("--radius", `${radius}px`);
  document.documentElement.style.setProperty("--border-width", `${borderWidth}px`);
}

function persistPreset(preset: ThemePreset) {
  const defs = getAppDefaults(preset.base);
  const overrides: Record<string, string> = {};
  for (const [k, v] of Object.entries(preset.colors)) {
    if (v.toLowerCase() !== (defs[k] ?? "").toLowerCase()) overrides[k] = v;
  }
  localStorage.setItem("mc_theme", preset.base);
  saveOverrides(preset.base, overrides);
  localStorage.setItem("mc_radius", String(preset.borderRadius));
  localStorage.setItem("mc_border_width", String(preset.borderWidth));
  setActivePresetId(preset.id);
  applyLive(preset.base, preset.colors, preset.borderRadius, preset.borderWidth);
}

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

const RELEASE_DATE = "May 9, 2026";
const GITHUB_RELEASES_URL = "https://github.com/KanQual/kanqual/releases";

// ─── Color row ────────────────────────────────────────────────────────────────

import { useEffect } from "react";

function ColorRow({
  varDef,
  value,
  defaultValue,
  onChange,
  onReset,
}: {
  varDef: ColorVar;
  value: string;
  defaultValue: string;
  onChange: (key: string, val: string) => void;
  onReset: (key: string) => void;
}) {
  const [hexInput, setHexInput] = useState(value);
  const isCustom = value.toLowerCase() !== defaultValue.toLowerCase();

  useEffect(() => { setHexInput(value); }, [value]);

  function handlePickerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setHexInput(val);
    onChange(varDef.key, val);
  }

  function handleHexChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    setHexInput(raw);
    if (isValidHex(raw)) onChange(varDef.key, normalizeHex(raw));
  }

  function handleHexBlur() {
    if (!isValidHex(hexInput)) setHexInput(value);
    else setHexInput(normalizeHex(hexInput));
  }

  return (
    <div className={`color-row${isCustom ? " color-row--custom" : ""}`}>
      <div className="color-row-swatch" style={{ background: value }} />
      <span className="color-row-label">{varDef.label}</span>
      <input
        type="color"
        className="color-row-picker"
        value={value}
        onChange={handlePickerChange}
        title="Open color picker"
      />
      <input
        type="text"
        className="form-input color-row-hex"
        value={hexInput}
        onChange={handleHexChange}
        onBlur={handleHexBlur}
        spellCheck={false}
        maxLength={7}
        placeholder="#000000"
      />
      {isCustom ? (
        <button
          type="button"
          className="btn btn--sm color-row-reset"
          onClick={() => onReset(varDef.key)}
          title="Reset to default"
        >
          ↺
        </button>
      ) : (
        <span className="color-row-reset-spacer" />
      )}
    </div>
  );
}

// ─── Slider row ───────────────────────────────────────────────────────────────

function SliderRow({
  label,
  desc,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  desc: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="slider-row">
      <div className="slider-row-info">
        <span className="slider-row-label">{label}</span>
        <span className="slider-row-desc">{desc}</span>
      </div>
      <div className="slider-row-controls">
        <input
          type="range"
          className="slider-input"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="slider-value">
          {value}
          {unit}
        </span>
      </div>
    </div>
  );
}

// ─── Theme editor (rendered inside modal) ─────────────────────────────────────

function ThemeEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: ThemePreset;
  onSave: (preset: ThemePreset) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [base, setBase] = useState<Theme>(initial.base);
  const [colors, setColors] = useState<Record<string, string>>(initial.colors);
  const [borderRadius, setBorderRadius] = useState(initial.borderRadius);
  const [borderWidth, setBorderWidth] = useState(initial.borderWidth);

  // Live preview — applies to the page instantly, nothing persisted
  useEffect(() => {
    applyLive(base, colors, borderRadius, borderWidth);
  }, [base, colors, borderRadius, borderWidth]);

  const defaults = getAppDefaults(base);
  const groups = [...new Set(COLOR_VARS.map((v) => v.group))];

  function handleBaseChange(t: Theme) {
    setBase(t);
    setColors({ ...getAppDefaults(t) });
  }

  function handleResetDefaults() {
    setColors({ ...getAppDefaults(base) });
    setBorderRadius(6);
    setBorderWidth(1);
  }

  const handleColorChange = useCallback((key: string, val: string) => {
    setColors((prev) => ({ ...prev, [key]: val }));
  }, []);

  const handleReset = useCallback(
    (key: string) => {
      setColors((prev) => ({ ...prev, [key]: getAppDefaults(base)[key] }));
    },
    [base],
  );

  function handleSave() {
    onSave({
      id: initial.id,
      name: name.trim() || "Untitled Theme",
      base,
      colors,
      borderRadius,
      borderWidth,
    });
  }

  return (
    <>
      {/* Name */}
      <div className="theme-editor-field">
        <label className="form-label">
          Name
          <input
            className="form-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Theme"
            autoFocus
          />
        </label>
      </div>

      {/* Base mode */}
      <div className="theme-editor-field">
        <div className="form-label" style={{ marginBottom: 8 }}>
          Base Mode
        </div>
        <div className="theme-options" style={{ justifyContent: "flex-start" }}>
          {(["light", "dark"] as Theme[]).map((t) => (
            <button
              key={t}
              className={`theme-option${base === t ? " theme-option--active" : ""}`}
              onClick={() => handleBaseChange(t)}
              aria-pressed={base === t}
            >
              <div className={`theme-preview theme-preview--${t}`}>
                <div className="theme-preview-sidebar" />
                <div className="theme-preview-content">
                  <div className="theme-preview-bar" style={{ width: "70%" }} />
                  <div className="theme-preview-bar" style={{ width: "50%" }} />
                  <div className="theme-preview-bar" style={{ width: "60%" }} />
                </div>
              </div>
              {t === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
      </div>

      {/* UI style */}
      <div className="theme-editor-field">
        <div className="form-label" style={{ marginBottom: 8 }}>
          UI Style
        </div>
        <SliderRow
          label="Corner Radius"
          desc="Roundness of corners on cards, buttons, and inputs"
          value={borderRadius}
          min={0}
          max={20}
          unit="px"
          onChange={setBorderRadius}
        />
        <SliderRow
          label="Border Width"
          desc="Thickness of borders on cards, modals, and inputs"
          value={borderWidth}
          min={1}
          max={4}
          unit="px"
          onChange={setBorderWidth}
        />
      </div>

      {/* Colors */}
      <div className="theme-editor-field">
        <div className="form-label" style={{ marginBottom: 8 }}>
          Colors
        </div>
        <div className="color-groups">
          {groups.map((group) => (
            <div key={group} className="color-group">
              <h3 className="color-group-title">{group}</h3>
              {COLOR_VARS.filter((v) => v.group === group).map((varDef) => (
                <ColorRow
                  key={varDef.key}
                  varDef={varDef}
                  value={colors[varDef.key] ?? defaults[varDef.key]}
                  defaultValue={defaults[varDef.key]}
                  onChange={handleColorChange}
                  onReset={handleReset}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="form-actions">
        <button className="btn" onClick={handleResetDefaults}>
          Reset to Defaults
        </button>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn--primary" onClick={handleSave}>
          Save Theme
        </button>
      </div>
    </>
  );
}

// ─── Theme manager modal ───────────────────────────────────────────────────────

export function ThemeManagerModal({
  onClose,
  onApplied,
}: {
  onClose: () => void;
  onApplied: () => void;
}) {
  const [presets, setPresets] = useState<ThemePreset[]>(getPresets);
  const [editing, setEditing] = useState<ThemePreset | null>(null);
  const snapshotRef = useRef<ReturnType<typeof currentSnapshot> | null>(null);

  function openNew() {
    snapshotRef.current = currentSnapshot();
    const snap = snapshotRef.current;
    setEditing({
      id: genId(),
      name: "",
      base: snap.base,
      colors: { ...snap.colors },
      borderRadius: snap.radius,
      borderWidth: snap.borderWidth,
    });
  }

  function openEdit(preset: ThemePreset) {
    snapshotRef.current = currentSnapshot();
    setEditing({ ...preset, colors: { ...preset.colors } });
  }

  function handleSave(preset: ThemePreset) {
    savePreset(preset);
    persistPreset(preset);
    setPresets(getPresets());
    setEditing(null);
    snapshotRef.current = null;
    onApplied();
  }

  function handleCancel() {
    const s = snapshotRef.current;
    if (s) {
      applyLive(s.base, s.colors, s.radius, s.borderWidth);
      snapshotRef.current = null;
    }
    setEditing(null);
    onApplied();
  }

  function handleApply(preset: ThemePreset) {
    persistPreset(preset);
    onApplied();
  }

  function handleResetActiveDefaults() {
    resetThemeToDefaults(getStoredTheme());
    onApplied();
  }

  function handleDelete(id: string) {
    const wasActive = getActivePresetId() === id;
    const preset = presets.find((p) => p.id === id);
    deletePreset(id);
    setPresets(getPresets());
    if (wasActive) {
      resetThemeToDefaults(preset?.base ?? getStoredTheme());
      onApplied();
    }
  }

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !editing) onClose();
      }}
    >
      <div className={`modal ${editing ? "modal--theme-editor" : "modal--wide"}`}>
        {editing ? (
          <>
            <h2>{editing.name ? `Editing: ${editing.name}` : "New Theme"}</h2>
            <div className="theme-editor-scroll">
              <ThemeEditor
                initial={editing}
                onSave={handleSave}
                onCancel={handleCancel}
              />
            </div>
          </>
        ) : (
          <>
            <div className="theme-manager-header">
              <h2 style={{ marginBottom: 0 }}>Theme Presets</h2>
              <div className="theme-manager-actions">
                <button className="btn btn--sm" onClick={handleResetActiveDefaults}>
                  Reset to Defaults
                </button>
                <button className="btn btn--primary btn--sm" onClick={openNew}>
                  + New Theme
                </button>
              </div>
            </div>

            {presets.length === 0 ? (
              <div className="theme-manager-empty">
                <p>No saved themes yet.</p>
                <p>Create a theme to save your custom colors and UI style.</p>
              </div>
            ) : (
              <div className="theme-preset-list">
                {presets.map((p) => (
                  <div key={p.id} className="theme-preset-row">
                    <div className="theme-preset-swatches">
                      {(
                        ["--color-sidebar", "--color-primary", "--color-bg"] as const
                      ).map((k) => (
                        <span
                          key={k}
                          className="theme-preset-swatch"
                          style={{ background: p.colors[k] ?? "#ccc" }}
                        />
                      ))}
                    </div>
                    <div className="theme-preset-info">
                      <span className="theme-preset-name">
                        {p.name || "Untitled"}
                      </span>
                      <span
                        className={`theme-preset-badge theme-preset-badge--${p.base}`}
                      >
                        {p.base}
                      </span>
                      <span className="theme-preset-meta">
                        radius {p.borderRadius}px · border {p.borderWidth}px
                      </span>
                    </div>
                    <div className="theme-preset-actions">
                      <button
                        className="btn btn--sm btn--primary"
                        onClick={() => handleApply(p)}
                      >
                        Apply
                      </button>
                      <button
                        className="btn btn--sm"
                        onClick={() => openEdit(p)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn--sm btn--danger"
                        onClick={() => handleDelete(p.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="form-actions" style={{ marginTop: 24 }}>
              <button className="btn" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Network helpers ──────────────────────────────────────────────────────────

type PingStatus = "idle" | "loading" | "success" | "error";
interface PingResult { status: PingStatus; ms?: number; error?: string; }

function PingBadge({ result }: { result: PingResult }) {
  if (result.status === "idle")    return <span className="ping-badge ping-badge--idle">Not tested</span>;
  if (result.status === "loading") return <span className="ping-badge ping-badge--idle">Testing…</span>;
  if (result.status === "success") return <span className="ping-badge ping-badge--ok">● Reachable &nbsp;{result.ms} ms</span>;
  return (
    <span className="ping-badge ping-badge--error">
      ✕ Unreachable{result.error && <> — {result.error}</>}
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
          {loading ? "Detecting…" : (address ?? "Unavailable")}
        </code>
        <button className="btn btn--sm" disabled={!address} onClick={() => address && navigator.clipboard.writeText(address).catch(() => {})}>
          Copy
        </button>
        <button className="btn btn--sm btn--primary" disabled={!address || disabled || ping.status === "loading"} onClick={onTest}>
          {ping.status === "loading" ? "Testing…" : "Test"}
        </button>
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

function CollaborationPingBadge({
  result,
  scope,
}: {
  result: PingResult;
  scope: "local" | "internet";
}) {
  if (result.status === "idle") return <span className="ping-badge ping-badge--idle">Not tested</span>;
  if (result.status === "loading") return <span className="ping-badge ping-badge--idle">Testing...</span>;
  if (result.status === "success") {
    return (
      <span className="ping-badge ping-badge--ok">
        {scope === "local"
          ? "A user in the local network should be able to collaborate on your projects."
          : "A user on the internet should be able to collaborate on your projects."}
        {typeof result.ms === "number" && <> {result.ms} ms</>}
      </span>
    );
  }
  return (
    <span className="ping-badge ping-badge--error">
      {scope === "local"
        ? "A user in the local network might not be able to collaborate on your projects."
        : "A user on the internet might not be able to collaborate on your projects."}
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
  return date.toLocaleString([], {
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

export function AppSettingsView() {
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
  const [localIp, setLocalIp] = useState<string | null>(null);
  const [localIpError, setLocalIpError] = useState(false);
  const [externalIp, setExternalIp] = useState<string | null>(null);
  const [externalIpLoading, setExternalIpLoading] = useState(true);
  const [localPing, setLocalPing] = useState<PingResult>({ status: "idle" });
  const [externalPing, setExternalPing] = useState<PingResult>({ status: "idle" });
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [dbHealth, setDbHealth] = useState<"checking" | "ok" | "error">("checking");
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
  const [registeredUsers, setRegisteredUsers] = useState<RecordModel[]>([]);
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
      id: "permissions",
      title: "User Permissions",
      description: "Review the full role matrix for administrators, owners, editors, coders, and viewers.",
      visible: canOpenAppSettings,
    },
    {
      id: "network",
      title: "Network & Collaboration",
      description: "Control whether this device is accessible to collaborators.",
      visible: canOpenAppSettings,
    },
    {
      id: "storage",
      title: "Data Location & Storage",
      description: "View where local data and backups are stored.",
      visible: canOpenAppSettings,
    },
    {
      id: "startup",
      title: "Startup & Session",
      description: "Choose how Kanqual opens and resumes work.",
      visible: canChangeStartupSettings,
    },
    {
      id: "import",
      title: "Document Import",
      description: "Set default behaviors for importing and creating documents.",
      visible: canOpenAppSettings,
    },
    {
      id: "privacy",
      title: "Privacy & Security",
      description: "Manage local privacy options for shared or sensitive use.",
      visible: canOpenAppSettings,
    },
    {
      id: "diagnostics",
      title: "Diagnostics",
      description: "Check app health, storage, and environment details.",
      visible: canOpenAppSettings,
    },
    {
      id: "updates",
      title: "Updates",
      description: "Choose the release channel and whether Kanqual warns you when a newer version is available.",
      visible: canOpenAppSettings,
    },
    {
      id: "llm",
      title: "AI Assist Settings",
      description: "Download and setup local large language models for embeddings and and other AI Assist features.",
      visible: canManageLlmSettings || canDownloadEmbeddingModel || canDeleteEmbeddingModel,
    },
    ...(canAccessAdministration
      ? [{
          id: "administration",
          title: "Administration",
          description: "Manage registered users, clear local app data, and jump to administration views.",
          visible: true,
        }]
      : []),
  ].filter((card) => card.visible);

  const openRequestedSettingsModal = useCallback(() => {
    const requestedModal = sessionStorage.getItem("kanqual:open-app-settings-modal");
    if (!requestedModal) return;
    sessionStorage.removeItem("kanqual:open-app-settings-modal");
    if (settingsOverviewCards.some((card) => card.id === requestedModal)) {
      setActiveSettingsModal(requestedModal);
    }
  }, [settingsOverviewCards]);

  const permissionMatrixByCategory = permissionMatrixRows.reduce<Record<string, PermissionMatrixRow[]>>((acc, row) => {
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

  async function handleNetworkModeToggle(mode: "local" | "lan") {
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

  function persist(next: AppSettings, message: string) {
    setSettings(next);
    saveAppSettings(next);
    setNotice(message);
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
      return;
    }
    try {
      await pb.health.check();
      setDbHealth("ok");
    } catch {
      setDbHealth("error");
    }
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
        const records = await currentPb.collection("users").getFullList({
          sort: "created",
        });
        if (!cancelled) {
          setRegisteredUsers(records);
          setAdminNotice("");
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
  }, [activeSettingsModal, pb, canViewLocalUsers]);

  async function refreshRegisteredUsers() {
    if (!pb || !canViewLocalUsers) return;
    const records = await pb.collection("users").getFullList({ sort: "created" });
    setRegisteredUsers(records);
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
          <div className="permission-matrix">
            <p className="permission-matrix-intro">
              This matrix shows which actions each role can perform in the current KanQual permission model.
            </p>
            {Object.entries(permissionMatrixByCategory).map(([category, rows]) => (
              <section key={category} className="permission-matrix-section">
                <h3>{category}</h3>
                <div className="permission-matrix-table-wrap">
                  <table className="permission-matrix-table">
                    <thead>
                      <tr>
                        <th>Permission</th>
                        <th>Description</th>
                        <th>Administrator</th>
                        <th>Owner</th>
                        <th>Editor</th>
                        <th>Coder</th>
                        <th>Viewer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={`${row.category}-${row.permission}`}>
                          <td>{row.permission}</td>
                          <td>{row.description}</td>
                          <td className={row.administrator ? "permission-matrix-cell permission-matrix-cell--yes" : "permission-matrix-cell permission-matrix-cell--no"}>{row.administrator ? "✓" : "✕"}</td>
                          <td className={row.owner ? "permission-matrix-cell permission-matrix-cell--yes" : "permission-matrix-cell permission-matrix-cell--no"}>{row.owner ? "✓" : "✕"}</td>
                          <td className={row.editor ? "permission-matrix-cell permission-matrix-cell--yes" : "permission-matrix-cell permission-matrix-cell--no"}>{row.editor ? "✓" : "✕"}</td>
                          <td className={row.coder ? "permission-matrix-cell permission-matrix-cell--yes" : "permission-matrix-cell permission-matrix-cell--no"}>{row.coder ? "✓" : "✕"}</td>
                          <td className={row.viewer ? "permission-matrix-cell permission-matrix-cell--yes" : "permission-matrix-cell permission-matrix-cell--no"}>{row.viewer ? "✓" : "✕"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        );
      case "network":
        return (
          <>
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">Network mode</div>
                <div className="settings-row-desc">
                  {networkMode === "local"
                    ? "Local only - data is not accessible from other devices."
                    : localIp
                      ? `Network mode active - other devices can connect at http://${localIp}:8090`
                      : "Network mode active - other devices on your local network can connect."}
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
                      ? "Restarting..."
                      : option === "local" ? "Local only" : "Allow network"}
                  </button>
                ))}
              </div>
            </div>
            <div className={`settings-warning ${networkMode === "lan" ? "settings-warning--danger" : ""}`}>
              <strong>{networkMode === "lan" ? "LAN mode is live for this session." : "Local-only mode is recommended for routine work."}</strong>
              <br />
              {networkMode === "lan"
                ? "Anyone on the same trusted network who can reach this device can attempt to connect to Kanqual until the app closes or you switch back to local-only mode."
                : "Other devices cannot reach this Kanqual database while local-only mode is active."}
            </div>
            <div className="settings-warning">
              <strong>Session behavior and auditability</strong>
              <br />
              Kanqual always reverts to local-only mode on next launch. When a project is open, LAN/local mode changes are also written to that project's log.
            </div>

            {networkMode === "lan" && (
              <>
                <CollaborationAddressCard
                  label="Local Network"
                  description="Reachable by devices on the same Wi-Fi or LAN. Share this address with collaborators on your local network."
                  host={localIpError ? null : localIp}
                  port={8090}
                  loading={!localIp && !localIpError}
                  ping={localPing}
                  disabled={networkMode !== "lan"}
                  onTest={testLocalPing}
                  scope="local"
                />

                <CollaborationAddressCard
                  label="External / Internet"
                  description="Reachable from outside your network. Requires port forwarding configured on your router."
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
          </>
        );
      case "storage":
        return (
          <>
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">Storage mode</div>
                <div className="settings-row-desc">
                  {appInfo?.portableMode === true
                    ? "Portable"
                    : appInfo?.portableMode === false
                      ? "Installed / user profile"
                      : "Loading..."}
                </div>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">App data folder</div>
                <div className="settings-row-desc settings-code-line">{appInfo?.appDataDir ?? "Loading..."}</div>
              </div>
              {appInfo?.appDataDir && (
                <button
                  className="btn"
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(appInfo.appDataDir)}
                >
                  Copy Path
                </button>
              )}
            </div>

            <div className="app-settings-stats">
              <div className="app-settings-stat-card">
                <strong>Database</strong>
                <span>{formatBytes(storageSummary.databaseBytes)}</span>
                <small>{storageSummary.databaseFiles} files in `pb_data`</small>
              </div>
              <div className="app-settings-stat-card">
                <strong>Backups</strong>
                <span>{formatBytes(storageSummary.backupBytes)}</span>
                <small>{storageSummary.backupFiles} files in `project_backups`</small>
              </div>
              <div className="app-settings-stat-card">
                <strong>Total tracked storage</strong>
                <span>{formatBytes(storageSummary.databaseBytes + storageSummary.backupBytes)}</span>
                <small>Database plus managed backup files</small>
              </div>
            </div>
          </>
        );
      case "startup":
        if (!canChangeStartupSettings) {
          return <div className="settings-empty-state">You do not have permission to change startup or session settings.</div>;
        }
        return (
          <>
            <label className="settings-toggle-row">
              <span>
                <strong>Sign in last user on launch</strong>
                <small>If a valid local session exists, Kanqual will automatically sign that user in when the app opens.</small>
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
          </>
        );
      case "import":
        return (
          <>
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">Default import mode</div>
                <div className="settings-row-desc">Choose whether the new document dialog starts in upload mode or paste mode.</div>
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
                    }, "Document import defaults saved.")}
                  >
                    {option === "upload" ? "Upload" : "Paste"}
                  </button>
                ))}
              </div>
            </div>

            <label className="settings-toggle-row">
              <span>
                <strong>Auto-name documents from uploaded files</strong>
                <small>Pre-fills the document name from the selected filename when the name field is empty.</small>
              </span>
              <input
                type="checkbox"
                checked={settings.documentImport.autoNameFromFile}
                onChange={(e) => persist({
                  ...settings,
                  documentImport: { ...settings.documentImport, autoNameFromFile: e.target.checked },
                }, "Document import defaults saved.")}
              />
            </label>

            <label className="settings-toggle-row">
              <span>
                <strong>Trim imported text automatically</strong>
                <small>Removes leading and trailing whitespace from pasted text and extracted file contents before save.</small>
              </span>
              <input
                type="checkbox"
                checked={settings.documentImport.trimImportedText}
                onChange={(e) => persist({
                  ...settings,
                  documentImport: { ...settings.documentImport, trimImportedText: e.target.checked },
                }, "Document import defaults saved.")}
              />
            </label>

            <label className="settings-toggle-row">
              <span>
                <strong>Warn before creating empty imports</strong>
                <small>Shows a confirmation if a file produces no extracted text and you continue anyway.</small>
              </span>
              <input
                type="checkbox"
                checked={settings.documentImport.warnBeforeEmptyImport}
                onChange={(e) => persist({
                  ...settings,
                  documentImport: { ...settings.documentImport, warnBeforeEmptyImport: e.target.checked },
                }, "Document import defaults saved.")}
              />
            </label>
          </>
        );
      case "privacy":
        return (
          <>
            <label className="settings-toggle-row">
              <span>
                <strong>Hide stored file names in document details</strong>
                <small>Masks filename metadata in the document detail view on this device.</small>
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
                <strong>Clear recent projects on sign-out</strong>
                <small>Removes the local recent-project list whenever you sign out of Kanqual.</small>
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
                <strong>Forget remembered usernames on sign-out</strong>
                <small>Removes saved local accounts and recent server connections so no usernames appear on the login screen after logout.</small>
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
          </>
        );
      case "diagnostics":
        return (
          <>
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">App version</div>
                <div className="settings-row-desc">{appInfo?.appVersion ?? "Loading..."}</div>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">Local database</div>
                <div className="settings-row-desc">
                  {dbHealth === "checking" ? "Checking local PocketBase health..." : dbHealth === "ok" ? "Healthy" : "Unavailable"}
                </div>
              </div>
              <button className="btn" type="button" onClick={() => void refreshDiagnostics()} disabled={storageBusy}>
                Re-check
              </button>
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">Database endpoint</div>
                <div className="settings-row-desc settings-code-line">http://127.0.0.1:8090</div>
              </div>
            </div>
          </>
        );
      case "administration":
        if (!canAccessAdministration) {
          return <div className="settings-empty-state">You do not have permission to access administration tools on this device.</div>;
        }
        return (
          <>
            <div className="settings-row settings-row--block">
              <div className="settings-row-info">
                <div className="settings-row-label">Administration Tools</div>
                <div className="settings-row-desc">
                  These actions are only available to administrators on this device.
                </div>
              </div>
            </div>

            <div className="app-settings-stats">
              <button
                type="button"
                className="app-settings-stat-card app-settings-stat-card--button"
                onClick={() => handleOpenAdminView("projects")}
              >
                <strong>Project Administration</strong>
                <span>Open Projects</span>
                <small>Manage projects, ownership, and project-level administration.</small>
              </button>
              <button
                type="button"
                className="app-settings-stat-card app-settings-stat-card--button"
                onClick={() => handleOpenAdminView("users")}
                disabled={!activeProject}
              >
                <strong>User Administration</strong>
                <span>{activeProject ? "Open Project Users" : "Open a project first"}</span>
                <small>Manage members and roles in the currently active project.</small>
              </button>
            </div>

            <div className="settings-row settings-row--block">
              <div className="settings-row-info">
                <div className="settings-row-label">Registered Users</div>
                <div className="settings-row-desc">
                  Delete local KanQual accounts from this device. Your current administrator account cannot be deleted here.
                </div>
              </div>
            </div>

            <div className="settings-list">
              {registeredUsers.map((entry) => {
                const role = String(entry.app_role ?? "standard");
                const isCurrentUser = entry.id === user?.id;
                return (
                  <div key={entry.id} className="settings-list-item">
                    <div className="settings-list-item-info">
                      <strong>{String(entry.name || entry.email || "Unnamed user")}</strong>
                      <small>{String(entry.email || "No email")}</small>
                      <small>{role === "administrator" ? "Administrator" : "Standard user"}</small>
                    </div>
                    <button
                      type="button"
                      className="btn btn--danger"
                      onClick={() => void handleDeleteRegisteredUser(entry.id)}
                      disabled={adminBusy || isCurrentUser || !canDeleteLocalUsers}
                    >
                      {isCurrentUser ? "Current Account" : !canDeleteLocalUsers ? "No Permission" : "Delete"}
                    </button>
                  </div>
                );
              })}
              {!registeredUsers.length && !adminBusy && canViewLocalUsers && (
                <div className="settings-empty-state">No registered users found.</div>
              )}
              {!canViewLocalUsers && (
                <div className="settings-empty-state">You do not have permission to view local users.</div>
              )}
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-label">Clear App Data</div>
                <div className="settings-row-desc">
                  Wipe all local KanQual records on this device, including users, projects, and stored working data.
                </div>
              </div>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => void handleClearAppData()}
                disabled={adminBusy || !canClearLocalAppData}
              >
                Clear App Data
              </button>
            </div>

            {adminNotice && <div className="settings-notice">{adminNotice}</div>}
          </>
        );
      case "updates":
        return (
          <>
            <label className="settings-toggle-row">
              <span>
                <strong>Check for updates automatically</strong>
                <small>Checks GitHub releases on startup and shows a warning when a newer version is available.</small>
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
                <div className="settings-row-label">Latest releases</div>
                <div className="settings-row-desc">Open the KanQual GitHub releases page in your default browser.</div>
              </div>
              <button
                className="btn"
                type="button"
                onClick={() => void openUrl(GITHUB_RELEASES_URL)}
              >
                Open Releases Page
              </button>
            </div>

          </>
        );
      case "llm":
        if (!(canManageLlmSettings || canDownloadEmbeddingModel || canDeleteEmbeddingModel)) {
          return <div className="settings-empty-state">You do not have permission to manage local AI Assist settings on this device.</div>;
        }
        return (
          <>
            <div className="settings-row settings-row--block">
              <div className="settings-row-info">
                <div className="settings-row-label">Embedding model</div>
                <div className="settings-row-desc">
                  Step 1: download the multilingual-e5 embedding model to this device. Step 2: keep it installed so Kanqual can build project embeddings. Step 3: tune chunking below before you run or rebuild embeddings for a project.
                </div>
              </div>
            </div>

            {embeddingModelError && <div className="form-error project-settings-error">{embeddingModelError}</div>}
            {embeddingModelNotice && <div className="settings-success project-settings-success">{embeddingModelNotice}</div>}

            <div className="project-model-card">
              <div>
                <div className="project-model-name">{embeddingModelStatus?.displayName ?? "multilingual-e5-large"}</div>
                <p className="project-model-description">
                  Repo: <code>{embeddingModelStatus?.repoId ?? "intfloat/multilingual-e5-large"}</code>
                </p>
                <p className="project-model-description">
                  Status: {embeddingModelStatus?.installed ? "Downloaded locally" : "Not downloaded yet"}
                  {embeddingModelStatus?.bytes ? ` | ${formatBytes(embeddingModelStatus.bytes)}` : ""}
                  {embeddingModelStatus?.files ? ` | ${embeddingModelStatus.files} files` : ""}
                </p>
                <p className="project-model-description">
                  Completion status: {formatCompletionStatus(embeddingModelDownloadStatus, embeddingModelStatus)}
                </p>
                <p className="project-model-description">
                  Total download size: {formatBytes(embeddingModelPreflight?.totalBytes ?? 0)}
                </p>
                <p className="project-model-description">
                  Already on device: {formatBytes(embeddingModelPreflight?.existingBytes ?? embeddingModelStatus?.bytes ?? 0)}
                  {embeddingModelPreflight?.manifestAvailable
                    ? ` | ${embeddingModelPreflight?.existingFiles ?? 0} files`
                    : ""}
                </p>
                <p className="project-model-description">
                  Remaining download: {formatBytes(embeddingModelPreflight?.remainingBytes ?? 0)}
                  {embeddingModelPreflight?.manifestAvailable && embeddingModelPreflight?.remainingFiles != null
                    ? ` across ${embeddingModelPreflight.remainingFiles} files`
                    : ""}
                </p>
                <p className="project-model-description">
                  Downloaded: {embeddingModelStatus?.installed ? formatDownloadDate(embeddingModelStatus.downloadedAtMs) : "Not downloaded yet"}
                </p>
                <p className="project-model-description">
                  Location: <code>{embeddingModelStatus?.modelDir ?? "Detecting local model directory..."}</code>
                </p>
                {embeddingModelPreflight?.message && (
                  <p className="project-model-description">{embeddingModelPreflight.message}</p>
                )}
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

            <div className="llm-settings-grid">
              <label className="form-label">
                Chunk size
                <span className="settings-field-hint">
                  Step 1 after download: choose how much text Kanqual should place into each embedding chunk before indexing.
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
                  Step 2: keep some shared text between neighboring chunks so retrieval can preserve context across boundaries.
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
                  Step 3: choose how many chunks Kanqual should process together when it builds embeddings.
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

            <div className="settings-row settings-row--block">
              <div className="settings-row-info">
                <div className="settings-row-label">Local LLM over HTTP</div>
                <div className="settings-row-desc">
                  Step 1: enable local LLM integration. Step 2: enter the LLM service's address and port. Step 3: test the connection. Step 4: choose the model Kanqual should use for generation features.
                </div>
              </div>
            </div>

            <label className="settings-toggle-row">
              <span>
                <strong>Enable local LLM integration</strong>
                <small>Save local LLM connection details and make them available for future AI Assist generation features.</small>
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

            <fieldset className="llm-connection-layout" disabled={!canManageLlmSettings} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
              <div className="llm-connection-fields">
                <label className="form-label">
                  Protocol
                  <span className="settings-field-hint">
                    Most local LLM setups use plain HTTP on the local machine.
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
                  Local LLM host / URL
                  <span className="settings-field-hint">
                    Usually <code>127.0.0.1</code>, <code>localhost</code>, or a reachable LAN address.
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
                    Many local LLM servers use <code>11434</code> by default.
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
                    Maximum seconds to wait when testing the local LLM server or listing models.
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
              </div>

              <div className="llm-connection-side">
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

                <div className="project-export-actions project-export-actions--modal llm-connection-actions">
                  <button
                    className="btn btn--primary"
                    type="button"
                    onClick={() => void handleOllamaTestConnection()}
                    disabled={ollamaBusy || !canManageLlmSettings}
                  >
                    {ollamaBusy ? "Testing..." : "Test Connection"}
                  </button>
                </div>
              </div>
            </fieldset>

            {ollamaError && <div className="form-error project-settings-error">{ollamaError}</div>}
            {ollamaNotice && <div className="settings-success project-settings-success">{ollamaNotice}</div>}

            <div className="settings-row settings-row--block">
              <div className="settings-row-info">
                <div className="settings-row-label">LLM Settings</div>
                <div className="settings-row-desc">
                  Once the connection test succeeds, pick a model first, then adjust how Kanqual should use it during AI Assist generation and retrieval workflows.
                </div>
              </div>
            </div>

            <fieldset className="llm-settings-grid" disabled={!canManageLlmSettings} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
              <label className="form-label">
                Available local model
                <span className="settings-field-hint">
                  Test the connection first to load the installed local models from this server.
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

              <label className="form-label">
                Temperature
                <span className="settings-field-hint">
                  Lower values are more deterministic. Saved now for future local LLM generation requests.
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
                  Saved as the default local LLM <code>num_ctx</code> target for future AI Assist generation requests.
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
                  Saved as the future local LLM keep-alive target so models can stay warm between requests.
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
                  Number of top embedding matches from the open document to send to the local LLM before it chooses the most relevant ones.
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
                  Maximum number of segments the local LLM should send back for AI Assisted Coding after reviewing the shortlist.
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


          </>
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
                <h2>About KanQual</h2>
                <p>Release, citation, license, and dependency information for this installation.</p>
              </div>
              <button
                type="button"
                className="btn btn--sm app-settings-about-toggle"
                onClick={() => setAboutCardExpanded((expanded) => !expanded)}
                aria-expanded={aboutCardExpanded}
              >
                {aboutCardExpanded ? "Collapse" : "Expand"}
              </button>
            </div>
            {aboutCardExpanded && (
            <div className="app-settings-about-body">
              <section className="about-kanqual-section">
                <h4>Release</h4>
                <div className="about-kanqual-meta-grid">
                  <div className="about-kanqual-meta-card">
                    <span className="about-kanqual-meta-label">Version</span>
                    <strong>{appInfo?.appVersion ?? "0.9.1"}</strong>
                  </div>
                  <div className="about-kanqual-meta-card">
                    <span className="about-kanqual-meta-label">Release date</span>
                    <strong>{RELEASE_DATE}</strong>
                  </div>
                </div>
              </section>

              <hr className="about-kanqual-separator" />

              <section className="about-kanqual-section">
                <h4>Created By</h4>
                <p>
                  Created by Mehmet Cansoy - Associate Prof. of Sociology at Fairfield University
                </p>
              </section>

              <hr className="about-kanqual-separator" />

              <section className="about-kanqual-section">
                <h4>Citation</h4>
                <p>
                  If you cite KanQual in scientific publications, use a software citation that
                  includes the author, year, software title, version, and institution.
                </p>
                <div className="about-kanqual-citation">
                  Cansoy, M. (2026). <em>KanQual</em> (Version {appInfo?.appVersion ?? "0.9.1"}){" "}
                  [Computer software]. https://github.com/KanQual/kanqual
                </div>
              </section>

              <hr className="about-kanqual-separator" />

              <section className="about-kanqual-section">
                <h4>License</h4>
                <p>
                  KanQual is released under the Apache License 2.0. This allows personal,
                  academic, organizational, and commercial use, including modification and
                  redistribution, as long as the Apache 2.0 terms and notices are preserved.
                </p>
              </section>

              <hr className="about-kanqual-separator" />

              <section className="about-kanqual-section">
                <h4>Dependency Licenses</h4>
                <p className="about-kanqual-license-note">
                  Complete release inventory of the dependency licenses currently resolved in this
                  build of KanQual.
                </p>

                <div className="about-kanqual-license-block">
                  <h5>JavaScript / TypeScript</h5>
                  <div className="about-kanqual-license-table-wrap">
                    <table className="about-kanqual-license-table">
                      <thead>
                        <tr>
                          <th>Package</th>
                          <th>Version</th>
                          <th>License</th>
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
                  <h5>Rust</h5>
                  <div className="about-kanqual-license-table-wrap">
                    <table className="about-kanqual-license-table">
                      <thead>
                        <tr>
                          <th>Crate</th>
                          <th>Version</th>
                          <th>License</th>
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

          <div className="app-settings-overview-grid">
          {settingsOverviewCards.map((card) => (
            <button
              key={card.id}
              type="button"
              className="app-settings-overview-card"
              onClick={() => setActiveSettingsModal(card.id)}
            >
              <h3>{card.title}</h3>
              <p>{card.description}</p>
            </button>
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
            <p className="settings-section-desc">
              Control whether this device's database is accessible to other computers on your local network.
              Kanqual always starts in local-only mode and reverts on next launch.
            </p>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">Network mode</div>
            <div className="settings-row-desc">
              {networkMode === "local"
                ? "Local only — data is not accessible from other devices."
                : localIp
                  ? `Network mode active — other devices can connect at http://${localIp}:8090`
                  : "Network mode active — other devices on your local network can connect."}
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
                  ? "Restarting..."
                  : option === "local" ? "Local only" : "Allow network"}
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
              label="Local Network"
              description="Reachable by devices on the same Wi-Fi or LAN. Share this address with collaborators on your local network."
              host={localIpError ? null : localIp}
              port={8090}
              loading={!localIp && !localIpError}
              ping={localPing}
              disabled={networkMode !== "lan"}
              onTest={testLocalPing}
              scope="local"
            />

            <CollaborationAddressCard
              label="External / Internet"
              description="Reachable from outside your network. Requires port forwarding configured on your router."
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
            <h2 className="settings-section-title">Data Location & Storage</h2>
            <p className="settings-section-desc">Where Kanqual stores its local database and project backups on this device.</p>
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
            <div className="settings-row-label">Storage mode</div>
            <div className="settings-row-desc">
              {appInfo?.portableMode === true
                ? "Portable"
                : appInfo?.portableMode === false
                  ? "Installed / user profile"
                  : "Loading..."}
            </div>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">App data folder</div>
            <div className="settings-row-desc settings-code-line">{appInfo?.appDataDir ?? "Loading..."}</div>
          </div>
        </div>

        <div className="app-settings-stats">
          <div className="app-settings-stat-card">
            <strong>Database</strong>
            <span>{formatBytes(storageSummary.databaseBytes)}</span>
            <small>{storageSummary.databaseFiles} files in `pb_data`</small>
          </div>
          <div className="app-settings-stat-card">
            <strong>Backups</strong>
            <span>{formatBytes(storageSummary.backupBytes)}</span>
            <small>{storageSummary.backupFiles} files in `project_backups`</small>
          </div>
          <div className="app-settings-stat-card">
            <strong>Total tracked storage</strong>
            <span>{formatBytes(storageSummary.databaseBytes + storageSummary.backupBytes)}</span>
            <small>Database plus managed backup files</small>
          </div>
        </div>
      </section>

      <section className="settings-section settings-section--wide">
        <div className="settings-section-header">
          <div>
            <h2 className="settings-section-title">Startup & Session</h2>
            <p className="settings-section-desc">Controls for what happens when the app opens and how the workspace resumes.</p>
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
            <h2 className="settings-section-title">Document Import</h2>
            <p className="settings-section-desc">Default behavior for new document creation and file-based text extraction.</p>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">Default import mode</div>
            <div className="settings-row-desc">Choose whether the new document dialog starts in upload mode or paste mode.</div>
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
                }, "Document import defaults saved.")}
              >
                {option === "upload" ? "Upload" : "Paste"}
              </button>
            ))}
          </div>
        </div>

        <label className="settings-toggle-row">
          <span>
            <strong>Auto-name documents from uploaded files</strong>
            <small>Pre-fills the document name from the selected filename when the name field is empty.</small>
          </span>
          <input
            type="checkbox"
            checked={settings.documentImport.autoNameFromFile}
            onChange={(e) => persist({
              ...settings,
              documentImport: { ...settings.documentImport, autoNameFromFile: e.target.checked },
            }, "Document import defaults saved.")}
          />
        </label>

        <label className="settings-toggle-row">
          <span>
            <strong>Trim imported text automatically</strong>
            <small>Removes leading and trailing whitespace from pasted text and extracted file contents before save.</small>
          </span>
          <input
            type="checkbox"
            checked={settings.documentImport.trimImportedText}
            onChange={(e) => persist({
              ...settings,
              documentImport: { ...settings.documentImport, trimImportedText: e.target.checked },
            }, "Document import defaults saved.")}
          />
        </label>

        <label className="settings-toggle-row">
          <span>
            <strong>Warn before creating empty imports</strong>
            <small>Shows a confirmation if a file produces no extracted text and you continue anyway.</small>
          </span>
          <input
            type="checkbox"
            checked={settings.documentImport.warnBeforeEmptyImport}
            onChange={(e) => persist({
              ...settings,
              documentImport: { ...settings.documentImport, warnBeforeEmptyImport: e.target.checked },
            }, "Document import defaults saved.")}
          />
        </label>
      </section>

      <section className="settings-section settings-section--wide">
        <div className="settings-section-header">
          <div>
            <h2 className="settings-section-title">Privacy & Security</h2>
            <p className="settings-section-desc">Local privacy controls for shared machines and sensitive research workspaces.</p>
          </div>
        </div>

        <label className="settings-toggle-row">
          <span>
            <strong>Hide stored file names in document details</strong>
            <small>Masks filename metadata in the document detail view on this device.</small>
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
            <strong>Clear recent projects on sign-out</strong>
            <small>Removes the local recent-project list whenever you sign out of Kanqual.</small>
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
            <strong>Forget remembered usernames on sign-out</strong>
            <small>Removes saved local accounts and recent server connections so no usernames appear on the login screen after logout.</small>
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
            <p className="settings-section-desc">Quick checks for local app health and environment details.</p>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">App version</div>
            <div className="settings-row-desc">{appInfo?.appVersion ?? "Loading..."}</div>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">Local database</div>
            <div className="settings-row-desc">
              {dbHealth === "checking" ? "Checking local PocketBase health..." : dbHealth === "ok" ? "Healthy" : "Unavailable"}
            </div>
          </div>
          <button className="btn" type="button" onClick={() => void refreshDiagnostics()} disabled={storageBusy}>
            Re-check
          </button>
        </div>

        <div className="settings-row">
          <div className="settings-row-info">
            <div className="settings-row-label">Database endpoint</div>
            <div className="settings-row-desc settings-code-line">http://127.0.0.1:8090</div>
          </div>
        </div>
      </section>

      <section className="settings-section settings-section--wide">
        <div className="settings-section-header">
          <div>
            <h2 className="settings-section-title">Update Behavior</h2>
            <p className="settings-section-desc">Early placeholders for desktop update preferences as bundling and distribution mature.</p>
          </div>
        </div>

        <label className="settings-toggle-row">
          <span>
            <strong>Check for updates automatically</strong>
            <small>Checks GitHub releases on startup and shows a warning when a newer version is available.</small>
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
            <div className="settings-row-label">Latest releases</div>
            <div className="settings-row-desc">Open the KanQual GitHub releases page in your default browser.</div>
          </div>
          <button
            className="btn"
            type="button"
            onClick={() => void openUrl(GITHUB_RELEASES_URL)}
          >
            Open Releases Page
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
                <p className="settings-section-desc">{activeSettingsCard.description}</p>
              </div>
              <button className="btn" type="button" onClick={() => setActiveSettingsModal(null)}>
                Close
              </button>
            </div>
            <div className="app-settings-modal-body">
              {renderSettingsModalBody(activeSettingsCard.id)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
