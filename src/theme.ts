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
}

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
};

export function getAppDefaults(theme: Theme): Record<string, string> {
  return theme === "dark" ? DARK_DEFAULTS : LIGHT_DEFAULTS;
}

export function getDefaults(theme: Theme): Record<string, string> {
  return getAppDefaults(theme);
}

export function getStoredTheme(): Theme {
  return (localStorage.getItem("mc_theme") as Theme) ?? "light";
}

export function getStoredOverrides(theme: Theme): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(`mc_colors_${theme}`) ?? "{}");
  } catch {
    return {};
  }
}

export function saveOverrides(theme: Theme, overrides: Record<string, string>): void {
  localStorage.setItem(`mc_colors_${theme}`, JSON.stringify(overrides));
}

export function getStoredRadius(): number {
  return Number(localStorage.getItem("mc_radius") ?? "6");
}

export function getStoredBorderWidth(): number {
  return Number(localStorage.getItem("mc_border_width") ?? "1");
}

export function getStoredDensity(): Density {
  return (localStorage.getItem("kq_density") as Density) || "comfortable";
}

export function getStoredFontSize(): FontSize {
  return (localStorage.getItem("kq_font_size") as FontSize) || "normal";
}

export function applyDensity(density: Density): void {
  localStorage.setItem("kq_density", density);
  document.documentElement.setAttribute("data-density", density);
}

export function applyFontSize(size: FontSize): void {
  localStorage.setItem("kq_font_size", size);
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
  localStorage.setItem("mc_theme", theme);
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  applyOverrides(theme);
}

/** Call once at app startup to restore persisted theme + custom colors + ui settings */
export function initTheme(): void {
  applyTheme(getStoredTheme());
  document.documentElement.style.setProperty("--radius", `${getStoredRadius()}px`);
  document.documentElement.style.setProperty("--border-width", `${getStoredBorderWidth()}px`);
  applyDensity(getStoredDensity());
  applyFontSize(getStoredFontSize());
}

// ─── Theme presets ────────────────────────────────────────────────────────────

export function getPresets(): ThemePreset[] {
  try {
    return JSON.parse(localStorage.getItem("mc_presets") ?? "[]");
  } catch {
    return [];
  }
}

export function savePreset(preset: ThemePreset): void {
  const all = getPresets().filter((p) => p.id !== preset.id);
  all.push(preset);
  localStorage.setItem("mc_presets", JSON.stringify(all));
}

export function deletePreset(id: string): void {
  localStorage.setItem(
    "mc_presets",
    JSON.stringify(getPresets().filter((p) => p.id !== id)),
  );
}
