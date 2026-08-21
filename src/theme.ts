// ─── Theme utilities ──────────────────────────────────────────────────────────

export type Theme = "light" | "dark";
export type Density = "comfortable" | "compact";
export type FontSize = "small" | "normal" | "large";

export interface ColorVar {
  key: string;
  label: string;
  group: string;
}

export interface ThemePreset {
  id: string;
  name: string;
  base: Theme;
  colors: Record<string, string>;
  borderRadius: number;
  borderWidth: number;
  canvasGridEnabled: boolean;
  canvasGridDensity: number;
}

export interface ThemeState {
  lightOverrides: Record<string, string>;
  darkOverrides: Record<string, string>;
  borderRadius: number;
  borderWidth: number;
  canvasGridEnabled: boolean;
  canvasGridDensity: number;
  presets: ThemePreset[];
  activePresetId: string | null;
}

export const DEFAULT_CANVAS_GRID_ENABLED = true;
export const DEFAULT_CANVAS_GRID_DENSITY = 22;

const ACTIVE_THEME_PRESET_KEY = "mc_active_theme_preset";

type RuntimeThemePreferences = {
  theme: Theme;
  density: Density;
  fontSize: FontSize;
  themeState: ThemeState;
};

let runtimeThemePreferences: RuntimeThemePreferences | null = null;

export const COLOR_VARS: ColorVar[] = [
  { key: "--color-bg",             label: "Background",    group: "Interface" },
  { key: "--color-surface",        label: "Surface",       group: "Interface" },
  { key: "--color-surface-alt",    label: "Surface Alt",   group: "Interface" },
  { key: "--color-border",         label: "Border",        group: "Interface" },
  { key: "--color-text",           label: "Text",          group: "Interface" },
  { key: "--color-text-muted",     label: "Text Muted",    group: "Interface" },
  { key: "--color-primary",        label: "Primary",       group: "Interface" },
  { key: "--color-primary-dark",   label: "Primary Dark",  group: "Interface" },
  { key: "--color-danger",         label: "Danger",        group: "Interface" },
  { key: "--color-sidebar",        label: "Background",    group: "Sidebar" },
  { key: "--color-sidebar-text",   label: "Text",          group: "Sidebar" },
  { key: "--color-sidebar-muted",  label: "Muted Text",    group: "Sidebar" },
  { key: "--color-sidebar-hover",  label: "Hover",         group: "Sidebar" },
  { key: "--color-sidebar-active", label: "Active",        group: "Sidebar" },
  { key: "--canvas-background",    label: "Background",    group: "Canvas" },
  { key: "--canvas-grid-color",    label: "Gridlines",     group: "Canvas" },
  { key: "--color-heatmap-low",    label: "Heatmap Low",   group: "Reports" },
  { key: "--color-heatmap-high",   label: "Heatmap High",  group: "Reports" },
];

export const LIGHT_DEFAULTS: Record<string, string> = {
  "--color-bg":             "#F9F9F9",
  "--color-surface":        "#FFFFFF",
  "--color-surface-alt":    "#F0F0F0",
  "--color-border":         "#D1D5DB",
  "--color-text":           "#2C3E50",
  "--color-text-muted":     "#7F8C8D",
  "--color-primary":        "#B04A33",
  "--color-primary-dark":   "#8B3D2B",
  "--color-danger":         "#C0392B",
  "--color-sidebar":        "#2C3E50",
  "--color-sidebar-text":   "#FFFFFF",
  "--color-sidebar-muted":  "#AAB7B8",
  "--color-sidebar-hover":  "#34495E",
  "--color-sidebar-active": "#1A252F",
  "--canvas-background":    "#F8FBFF",
  "--canvas-grid-color":    "#DCE6EF",
  "--color-heatmap-low":    "#F1DDD7",
  "--color-heatmap-high":   "#B04A33",
};

export const DARK_DEFAULTS: Record<string, string> = {
  "--color-bg":             "#1B2631",
  "--color-surface":        "#2C3E50",
  "--color-surface-alt":    "#34495E",
  "--color-border":         "#455A64",
  "--color-text":           "#ECF0F1",
  "--color-text-muted":     "#95A5A6",
  "--color-primary":        "#C66048",
  "--color-primary-dark":   "#A0442D",
  "--color-danger":         "#E74C3C",
  "--color-sidebar":        "#151E26",
  "--color-sidebar-text":   "#FFFFFF",
  "--color-sidebar-muted":  "#7F8C8D",
  "--color-sidebar-hover":  "#2C3E50",
  "--color-sidebar-active": "#34495E",
  "--canvas-background":    "#1F2D3A",
  "--canvas-grid-color":    "#334756",
  "--color-heatmap-low":    "#5A403A",
  "--color-heatmap-high":   "#E29A86",
};

export function getAppDefaults(theme: Theme): Record<string, string> {
  return theme === "dark" ? DARK_DEFAULTS : LIGHT_DEFAULTS;
}

export function getDefaults(theme: Theme): Record<string, string> {
  return getAppDefaults(theme);
}

function cloneThemeState(themeState: ThemeState): ThemeState {
  return {
    lightOverrides: { ...themeState.lightOverrides },
    darkOverrides: { ...themeState.darkOverrides },
    borderRadius: themeState.borderRadius,
    borderWidth: themeState.borderWidth,
    canvasGridEnabled: themeState.canvasGridEnabled ?? DEFAULT_CANVAS_GRID_ENABLED,
    canvasGridDensity: themeState.canvasGridDensity ?? DEFAULT_CANVAS_GRID_DENSITY,
    presets: themeState.presets.map((preset) => ({
      ...preset,
      colors: { ...preset.colors },
      canvasGridEnabled: preset.canvasGridEnabled ?? DEFAULT_CANVAS_GRID_ENABLED,
      canvasGridDensity: preset.canvasGridDensity ?? DEFAULT_CANVAS_GRID_DENSITY,
    })),
    activePresetId: themeState.activePresetId,
  };
}

function readThemePresetsFromLocalStorage(): ThemePreset[] {
  try {
    return JSON.parse(localStorage.getItem("mc_presets") ?? "[]");
  } catch {
    return [];
  }
}

export function getStoredThemeState(): ThemeState {
  if (runtimeThemePreferences) {
    return cloneThemeState(runtimeThemePreferences.themeState);
  }
  try {
    return {
      lightOverrides: JSON.parse(localStorage.getItem("mc_colors_light") ?? "{}"),
      darkOverrides: JSON.parse(localStorage.getItem("mc_colors_dark") ?? "{}"),
      borderRadius: Number(localStorage.getItem("mc_radius") ?? "6"),
      borderWidth: Number(localStorage.getItem("mc_border_width") ?? "1"),
      canvasGridEnabled: localStorage.getItem("mc_canvas_grid_enabled") !== "false",
      canvasGridDensity: Number(localStorage.getItem("mc_canvas_grid_density") ?? String(DEFAULT_CANVAS_GRID_DENSITY)),
      presets: readThemePresetsFromLocalStorage(),
      activePresetId: localStorage.getItem(ACTIVE_THEME_PRESET_KEY),
    };
  } catch {
    return {
      lightOverrides: {},
      darkOverrides: {},
      borderRadius: 6,
      borderWidth: 1,
      canvasGridEnabled: DEFAULT_CANVAS_GRID_ENABLED,
      canvasGridDensity: DEFAULT_CANVAS_GRID_DENSITY,
      presets: [],
      activePresetId: null,
    };
  }
}

export function getStoredTheme(): Theme {
  if (runtimeThemePreferences) return runtimeThemePreferences.theme;
  return (localStorage.getItem("mc_theme") as Theme) ?? "light";
}

export function getStoredOverrides(theme: Theme): Record<string, string> {
  if (runtimeThemePreferences) {
    return { ...(theme === "dark" ? runtimeThemePreferences.themeState.darkOverrides : runtimeThemePreferences.themeState.lightOverrides) };
  }
  try {
    return JSON.parse(localStorage.getItem(`mc_colors_${theme}`) ?? "{}");
  } catch {
    return {};
  }
}

export function saveOverrides(theme: Theme, overrides: Record<string, string>): void {
  if (runtimeThemePreferences) {
    runtimeThemePreferences = {
      ...runtimeThemePreferences,
      themeState: {
        ...runtimeThemePreferences.themeState,
        lightOverrides: theme === "light" ? { ...overrides } : runtimeThemePreferences.themeState.lightOverrides,
        darkOverrides: theme === "dark" ? { ...overrides } : runtimeThemePreferences.themeState.darkOverrides,
      },
    };
    return;
  }
  localStorage.setItem(`mc_colors_${theme}`, JSON.stringify(overrides));
}

export function getStoredRadius(): number {
  if (runtimeThemePreferences) return runtimeThemePreferences.themeState.borderRadius;
  return Number(localStorage.getItem("mc_radius") ?? "6");
}

export function getStoredBorderWidth(): number {
  if (runtimeThemePreferences) return runtimeThemePreferences.themeState.borderWidth;
  return Number(localStorage.getItem("mc_border_width") ?? "1");
}

export function getStoredCanvasGridEnabled(): boolean {
  if (runtimeThemePreferences) return runtimeThemePreferences.themeState.canvasGridEnabled ?? DEFAULT_CANVAS_GRID_ENABLED;
  return localStorage.getItem("mc_canvas_grid_enabled") !== "false";
}

export function getStoredCanvasGridDensity(): number {
  if (runtimeThemePreferences) return runtimeThemePreferences.themeState.canvasGridDensity ?? DEFAULT_CANVAS_GRID_DENSITY;
  const parsed = Number(localStorage.getItem("mc_canvas_grid_density") ?? String(DEFAULT_CANVAS_GRID_DENSITY));
  return Number.isFinite(parsed) ? Math.min(48, Math.max(8, parsed)) : DEFAULT_CANVAS_GRID_DENSITY;
}

export function applyCanvasSettings(enabled: boolean, density: number): void {
  const nextDensity = Number.isFinite(density) ? Math.min(48, Math.max(8, density)) : DEFAULT_CANVAS_GRID_DENSITY;
  if (runtimeThemePreferences) {
    runtimeThemePreferences = {
      ...runtimeThemePreferences,
      themeState: {
        ...runtimeThemePreferences.themeState,
        canvasGridEnabled: enabled,
        canvasGridDensity: nextDensity,
      },
    };
  } else {
    localStorage.setItem("mc_canvas_grid_enabled", String(enabled));
    localStorage.setItem("mc_canvas_grid_density", String(nextDensity));
  }
  document.documentElement.setAttribute("data-canvas-grid", enabled ? "visible" : "hidden");
  document.documentElement.style.setProperty("--canvas-grid-density", `${nextDensity}px`);
}

export function getStoredDensity(): Density {
  if (runtimeThemePreferences) return runtimeThemePreferences.density;
  return (localStorage.getItem("kq_density") as Density) || "comfortable";
}

export function getStoredFontSize(): FontSize {
  if (runtimeThemePreferences) return runtimeThemePreferences.fontSize;
  return (localStorage.getItem("kq_font_size") as FontSize) || "normal";
}

export function applyDensity(density: Density): void {
  if (runtimeThemePreferences) {
    runtimeThemePreferences = {
      ...runtimeThemePreferences,
      density,
    };
  } else {
    localStorage.setItem("kq_density", density);
  }
  document.documentElement.setAttribute("data-density", density);
}

export function applyFontSize(size: FontSize): void {
  if (runtimeThemePreferences) {
    runtimeThemePreferences = {
      ...runtimeThemePreferences,
      fontSize: size,
    };
  } else {
    localStorage.setItem("kq_font_size", size);
  }
  document.documentElement.setAttribute("data-font-size", size);
}

/** Set/clear inline style overrides on :root for the given theme */
export function applyOverrides(theme: Theme): void {
  const allKeys = COLOR_VARS.map((v) => v.key);
  for (const key of allKeys) {
    document.documentElement.style.removeProperty(key);
  }
  const overrides = getStoredOverrides(theme);
  for (const [key, val] of Object.entries(overrides)) {
    document.documentElement.style.setProperty(key, val);
  }
}

export function applyTheme(theme: Theme): void {
  if (runtimeThemePreferences) {
    runtimeThemePreferences = {
      ...runtimeThemePreferences,
      theme,
    };
  } else {
    localStorage.setItem("mc_theme", theme);
  }
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  applyOverrides(theme);
}

export function setRuntimeThemePreferences(preferences: RuntimeThemePreferences | null): void {
  runtimeThemePreferences = preferences
    ? {
        ...preferences,
        themeState: cloneThemeState(preferences.themeState),
      }
    : null;
}

export function getActivePresetId(): string | null {
  if (runtimeThemePreferences) return runtimeThemePreferences.themeState.activePresetId;
  return localStorage.getItem(ACTIVE_THEME_PRESET_KEY);
}

export function setActivePresetId(id: string | null): void {
  if (runtimeThemePreferences) {
    runtimeThemePreferences = {
      ...runtimeThemePreferences,
      themeState: {
        ...runtimeThemePreferences.themeState,
        activePresetId: id,
      },
    };
    return;
  }
  if (id) localStorage.setItem(ACTIVE_THEME_PRESET_KEY, id);
  else localStorage.removeItem(ACTIVE_THEME_PRESET_KEY);
}

export function resetThemeToDefaults(theme: Theme = getStoredTheme()): void {
  if (runtimeThemePreferences) {
    runtimeThemePreferences = {
      ...runtimeThemePreferences,
      theme,
      themeState: {
        ...runtimeThemePreferences.themeState,
        lightOverrides: theme === "light" ? {} : runtimeThemePreferences.themeState.lightOverrides,
        darkOverrides: theme === "dark" ? {} : runtimeThemePreferences.themeState.darkOverrides,
        borderRadius: 6,
        borderWidth: 1,
        canvasGridEnabled: DEFAULT_CANVAS_GRID_ENABLED,
        canvasGridDensity: DEFAULT_CANVAS_GRID_DENSITY,
        activePresetId: null,
      },
    };
  } else {
    localStorage.setItem("mc_theme", theme);
    localStorage.removeItem(`mc_colors_${theme}`);
    localStorage.setItem("mc_radius", "6");
    localStorage.setItem("mc_border_width", "1");
    localStorage.setItem("mc_canvas_grid_enabled", String(DEFAULT_CANVAS_GRID_ENABLED));
    localStorage.setItem("mc_canvas_grid_density", String(DEFAULT_CANVAS_GRID_DENSITY));
  }
  setActivePresetId(null);

  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  for (const key of COLOR_VARS.map((v) => v.key)) {
    document.documentElement.style.removeProperty(key);
  }
  document.documentElement.style.setProperty("--radius", "6px");
  document.documentElement.style.setProperty("--border-width", "1px");
  applyCanvasSettings(DEFAULT_CANVAS_GRID_ENABLED, DEFAULT_CANVAS_GRID_DENSITY);
}

/** Call once at app startup to restore persisted theme + custom colors + ui settings */
export function initTheme(): void {
  applyTheme(getStoredTheme());
  document.documentElement.style.setProperty("--radius", `${getStoredRadius()}px`);
  document.documentElement.style.setProperty("--border-width", `${getStoredBorderWidth()}px`);
  applyCanvasSettings(getStoredCanvasGridEnabled(), getStoredCanvasGridDensity());
  applyDensity(getStoredDensity());
  applyFontSize(getStoredFontSize());
}

// ─── Theme presets ────────────────────────────────────────────────────────────

export function getPresets(): ThemePreset[] {
  if (runtimeThemePreferences) {
    return runtimeThemePreferences.themeState.presets.map((preset) => ({
      ...preset,
      colors: { ...preset.colors },
    }));
  }
  return readThemePresetsFromLocalStorage();
}

export function savePreset(preset: ThemePreset): void {
  const all = getPresets().filter((p) => p.id !== preset.id);
  all.push(preset);
  if (runtimeThemePreferences) {
    runtimeThemePreferences = {
      ...runtimeThemePreferences,
      themeState: {
        ...runtimeThemePreferences.themeState,
        presets: all.map((entry) => ({
          ...entry,
          colors: { ...entry.colors },
        })),
      },
    };
    return;
  }
  localStorage.setItem("mc_presets", JSON.stringify(all));
}

export function deletePreset(id: string): void {
  const next = getPresets().filter((p) => p.id !== id);
  if (runtimeThemePreferences) {
    runtimeThemePreferences = {
      ...runtimeThemePreferences,
      themeState: {
        ...runtimeThemePreferences.themeState,
        presets: next.map((preset) => ({
          ...preset,
          colors: { ...preset.colors },
        })),
      },
    };
    return;
  }
  localStorage.setItem("mc_presets", JSON.stringify(next));
}
