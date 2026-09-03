import { useMemo } from "react";
import { useI18n } from "../i18n/provider";
import { getActivePresetId, getAppDefaults, getPresets, type Theme, type ThemePreset } from "../theme";

function ThemePreviewThumbnail({ theme }: { theme: Theme }) {
  return (
    <div className={`theme-preview theme-preview--${theme}`}>
      <div className="theme-preview-sidebar" />
      <div className="theme-preview-content">
        <div className="theme-preview-bar" style={{ width: "70%" }} />
        <div className="theme-preview-bar" style={{ width: "50%" }} />
        <div className="theme-preview-bar" style={{ width: "60%" }} />
      </div>
    </div>
  );
}

function ThemePresetPreviewThumbnail({ preset }: { preset: ThemePreset }) {
  const defaults = getAppDefaults(preset.base);
  const color = (key: string) => preset.colors[key] ?? defaults[key] ?? "";
  const surface = color("--color-surface") || color("--color-bg") || "#f9fafb";
  const bar = color("--color-border") || color("--color-text-muted") || "#d1d5db";

  return (
    <div
      className="theme-preview theme-preview--custom"
      style={{
        borderColor: color("--color-border") || undefined,
        borderRadius: `${Math.max(2, preset.borderRadius)}px`,
      }}
    >
      <div
        className="theme-preview-sidebar"
        style={{ background: color("--color-sidebar") || color("--color-primary") || undefined }}
      />
      <div className="theme-preview-content" style={{ background: surface }}>
        <div className="theme-preview-bar" style={{ width: "70%", background: color("--color-primary") || bar }} />
        <div className="theme-preview-bar" style={{ width: "50%", background: bar }} />
        <div className="theme-preview-bar" style={{ width: "60%", background: color("--color-surface-alt") || bar }} />
      </div>
    </div>
  );
}

export function ActiveThemePreviewRow({
  theme,
  onEdit,
}: {
  theme: Theme;
  onEdit: () => void;
}) {
  const { t } = useI18n();
  const activeTheme = useMemo(() => {
    const activePresetId = getActivePresetId();
    const activePreset = activePresetId ? getPresets().find((preset) => preset.id === activePresetId) : null;
    return {
      name: activePreset?.name || (theme === "dark" ? t("sharedModals.theme.dark") : t("sharedModals.theme.light")),
      preset: activePreset ?? null,
    };
  }, [t, theme]);

  return (
    <div className="settings-row settings-row--theme-preview">
      <div className="settings-row-info">
        <div className="settings-row-label">{t("sharedModals.theme.activeTheme")}</div>
      </div>
      <div className="active-theme-preview-row">
        <div className="active-theme-preview-card" aria-label={t("sharedModals.theme.activeThemeAria", { name: activeTheme.name })}>
          {activeTheme.preset ? (
            <ThemePresetPreviewThumbnail preset={activeTheme.preset} />
          ) : (
            <ThemePreviewThumbnail theme={theme} />
          )}
          <div className="active-theme-preview-name">{activeTheme.name}</div>
        </div>
        <button type="button" className="btn" onClick={onEdit}>
          {t("sharedModals.theme.editTheme")}
        </button>
      </div>
    </div>
  );
}
