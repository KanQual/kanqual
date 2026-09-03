import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useI18n } from "../i18n/provider";
import { PlusIcon } from "./AppIcons";
import { SettingsModal } from "./SettingsModal";
import {
  type Theme,
  type ColorVar,
  type ThemePreset,
  COLOR_VARS,
  DEFAULT_CANVAS_GRID_DENSITY,
  DEFAULT_CANVAS_GRID_ENABLED,
  applyCanvasSettings,
  getAppDefaults,
  getStoredTheme,
  getStoredOverrides,
  saveOverrides,
  getStoredRadius,
  getStoredBorderWidth,
  getStoredCanvasGridDensity,
  getStoredCanvasGridEnabled,
  getPresets,
  savePreset,
  deletePreset,
  getActivePresetId,
  resetThemeToDefaults,
  setActivePresetId,
} from "../theme";

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
    canvasGridEnabled: getStoredCanvasGridEnabled(),
    canvasGridDensity: getStoredCanvasGridDensity(),
  };
}

function applyLive(
  base: Theme,
  colors: Record<string, string>,
  radius: number,
  borderWidth: number,
  canvasGridEnabled: boolean,
  canvasGridDensity: number,
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
  applyCanvasSettings(canvasGridEnabled, canvasGridDensity);
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
  localStorage.setItem("mc_canvas_grid_enabled", String(preset.canvasGridEnabled));
  localStorage.setItem("mc_canvas_grid_density", String(preset.canvasGridDensity));
  setActivePresetId(preset.id);
  applyLive(
    preset.base,
    preset.colors,
    preset.borderRadius,
    preset.borderWidth,
    preset.canvasGridEnabled,
    preset.canvasGridDensity,
  );
}

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
  const { t } = useI18n();
  const [hexInput, setHexInput] = useState(value);
  const isCustom = value.toLowerCase() !== defaultValue.toLowerCase();

  useEffect(() => {
    setHexInput(value);
  }, [value]);

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
        title={t("sharedModals.theme.openColorPicker")}
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
          title={t("sharedModals.theme.resetToDefault")}
        >
          {t("common.reset")}
        </button>
      ) : (
        <span className="color-row-reset-spacer" />
      )}
    </div>
  );
}

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

function ThemeEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: ThemePreset;
  onSave: (preset: ThemePreset) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initial.name);
  const [base, setBase] = useState<Theme>(initial.base);
  const [colors, setColors] = useState<Record<string, string>>(initial.colors);
  const [borderRadius, setBorderRadius] = useState(initial.borderRadius);
  const [borderWidth, setBorderWidth] = useState(initial.borderWidth);
  const [canvasGridEnabled, setCanvasGridEnabled] = useState(initial.canvasGridEnabled ?? DEFAULT_CANVAS_GRID_ENABLED);
  const [canvasGridDensity, setCanvasGridDensity] = useState(initial.canvasGridDensity ?? DEFAULT_CANVAS_GRID_DENSITY);

  useEffect(() => {
    applyLive(base, colors, borderRadius, borderWidth, canvasGridEnabled, canvasGridDensity);
  }, [base, colors, borderRadius, borderWidth, canvasGridDensity, canvasGridEnabled]);

  const defaults = getAppDefaults(base);
  const groups = [...new Set(COLOR_VARS.map((v) => v.group))];

  function handleBaseChange(theme: Theme) {
    setBase(theme);
    setColors({ ...getAppDefaults(theme) });
  }

  function handleResetDefaults() {
    setColors({ ...getAppDefaults(base) });
    setBorderRadius(6);
    setBorderWidth(1);
    setCanvasGridEnabled(DEFAULT_CANVAS_GRID_ENABLED);
    setCanvasGridDensity(DEFAULT_CANVAS_GRID_DENSITY);
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
      name: name.trim() || t("sharedModals.theme.untitledTheme"),
      base,
      colors,
      borderRadius,
      borderWidth,
      canvasGridEnabled,
      canvasGridDensity,
    });
  }

  return (
    <>
      <div className="theme-editor-scroll">
        <div className="theme-editor-field">
          <label className="form-label">
            {t("common.name")}
            <input
              className="form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("sharedModals.theme.myThemePlaceholder")}
              autoFocus
            />
          </label>
        </div>

        <div className="theme-editor-field">
          <div className="form-label" style={{ marginBottom: 8 }}>
            {t("sharedModals.theme.baseMode")}
          </div>
          <div className="theme-options" style={{ justifyContent: "flex-start" }}>
            {(["light", "dark"] as Theme[]).map((theme) => (
              <button
                key={theme}
                className={`theme-option${base === theme ? " theme-option--active" : ""}`}
                onClick={() => handleBaseChange(theme)}
                aria-pressed={base === theme}
              >
                <div className={`theme-preview theme-preview--${theme}`}>
                  <div className="theme-preview-sidebar" />
                  <div className="theme-preview-content">
                    <div className="theme-preview-bar" style={{ width: "70%" }} />
                    <div className="theme-preview-bar" style={{ width: "50%" }} />
                    <div className="theme-preview-bar" style={{ width: "60%" }} />
                  </div>
                </div>
                {theme === "light" ? t("sharedModals.theme.light") : t("sharedModals.theme.dark")}
              </button>
            ))}
          </div>
        </div>

        <div className="theme-editor-field">
          <div className="form-label" style={{ marginBottom: 8 }}>
            {t("sharedModals.theme.uiStyle")}
          </div>
          <SliderRow
            label={t("sharedModals.theme.cornerRadius")}
            desc={t("sharedModals.theme.cornerRadiusDescription")}
            value={borderRadius}
            min={0}
            max={20}
            unit="px"
            onChange={setBorderRadius}
          />
          <SliderRow
            label={t("sharedModals.theme.borderWidth")}
            desc={t("sharedModals.theme.borderWidthDescription")}
            value={borderWidth}
            min={1}
            max={4}
            unit="px"
            onChange={setBorderWidth}
          />
        </div>

        <div className="theme-editor-field">
          <div className="form-label" style={{ marginBottom: 8 }}>
            {t("sharedModals.theme.canvas")}
          </div>
          <div
            className="settings-row"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              gap: 16,
              alignItems: "center",
            }}
          >
            <div>
              <div className="settings-row-label">{t("sharedModals.canvas.gridlines")}</div>
              <div className="settings-row-desc">{t("sharedModals.canvas.gridlinesDescription")}</div>
            </div>
            <div className="segmented-control" role="tablist" aria-label={t("sharedModals.canvas.gridlinesAria")}>
              <button
                type="button"
                role="tab"
                aria-selected={canvasGridEnabled}
                className={`segmented-control-option${canvasGridEnabled ? " segmented-control-option--active" : ""}`}
                onClick={() => setCanvasGridEnabled(true)}
              >
                {t("sharedModals.canvas.show")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!canvasGridEnabled}
                className={`segmented-control-option${!canvasGridEnabled ? " segmented-control-option--active" : ""}`}
                onClick={() => setCanvasGridEnabled(false)}
              >
                {t("sharedModals.canvas.hide")}
              </button>
            </div>
          </div>
          <fieldset disabled={!canvasGridEnabled} style={{ border: 0, margin: 0, padding: 0 }}>
            <SliderRow
              label={t("sharedModals.canvas.gridlineDensity")}
              desc={t("sharedModals.canvas.gridlineDensityDescription")}
              value={canvasGridDensity}
              min={8}
              max={48}
              unit="px"
              onChange={setCanvasGridDensity}
            />
          </fieldset>
        </div>

        <div className="theme-editor-field">
          <div className="form-label" style={{ marginBottom: 8 }}>
            {t("sharedModals.theme.colors")}
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
      </div>

      <div className="app-settings-modal-footer">
        <button className="btn" onClick={handleResetDefaults}>
          {t("sharedModals.theme.resetToDefaults")}
        </button>
        <button className="btn" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button className="btn btn--primary" onClick={handleSave}>
          {t("sharedModals.theme.saveTheme")}
        </button>
      </div>
    </>
  );
}

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
      <div
        className="theme-preview-content"
        style={{ background: surface }}
      >
        <div className="theme-preview-bar" style={{ width: "70%", background: color("--color-primary") || bar }} />
        <div className="theme-preview-bar" style={{ width: "50%", background: bar }} />
        <div className="theme-preview-bar" style={{ width: "60%", background: color("--color-surface-alt") || bar }} />
      </div>
    </div>
  );
}

export function ThemeManagerModal({
  onClose,
  onApplied,
  onCanceled,
}: {
  onClose: () => void;
  onApplied: () => void | Promise<void>;
  onCanceled?: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [presets, setPresets] = useState<ThemePreset[]>(getPresets);
  const [editing, setEditing] = useState<ThemePreset | null>(null);
  const [openThemeActions, setOpenThemeActions] = useState<string | null>(null);
  const [themeActionsMenuPosition, setThemeActionsMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const snapshotRef = useRef<ReturnType<typeof currentSnapshot> | null>(null);
  const themeActionsMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openThemeActions) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Element | null;
      if (target?.closest("[data-theme-actions-trigger='true']")) return;
      if (themeActionsMenuRef.current?.contains(event.target as Node)) return;
      setOpenThemeActions(null);
      setThemeActionsMenuPosition(null);
    }
    function onViewportChange() {
      setOpenThemeActions(null);
      setThemeActionsMenuPosition(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [openThemeActions]);

  function openActionsMenu(
    event: MouseEvent<HTMLButtonElement>,
    id: string,
    actionCount: number,
  ) {
    if (openThemeActions === id) {
      setOpenThemeActions(null);
      setThemeActionsMenuPosition(null);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const margin = 8;
    const menuWidth = 160;
    const menuHeight = actionCount * 37 + 10;
    const belowTop = rect.bottom - 2;
    const aboveTop = rect.top - menuHeight + 2;
    const top = belowTop + menuHeight <= window.innerHeight - margin
      ? belowTop
      : Math.max(margin, aboveTop);
    const preferredLeft = rect.right - menuWidth;
    const fallbackLeft = rect.left;
    const left = Math.min(
      window.innerWidth - menuWidth - margin,
      Math.max(margin, preferredLeft < margin ? fallbackLeft : preferredLeft),
    );

    setThemeActionsMenuPosition({ top, left });
    setOpenThemeActions(id);
  }

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
      canvasGridEnabled: snap.canvasGridEnabled,
      canvasGridDensity: snap.canvasGridDensity,
    });
  }

  function openNewFromBase(base: Theme) {
    snapshotRef.current = currentSnapshot();
    setEditing({
      id: genId(),
      name: base === "light" ? t("sharedModals.theme.lightCustom") : t("sharedModals.theme.darkCustom"),
      base,
      colors: { ...getAppDefaults(base) },
      borderRadius: 6,
      borderWidth: 1,
      canvasGridEnabled: DEFAULT_CANVAS_GRID_ENABLED,
      canvasGridDensity: DEFAULT_CANVAS_GRID_DENSITY,
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
    void onApplied();
  }

  function handleCancel() {
    const snapshot = snapshotRef.current;
    if (snapshot) {
      applyLive(
        snapshot.base,
        snapshot.colors,
        snapshot.radius,
        snapshot.borderWidth,
        snapshot.canvasGridEnabled,
        snapshot.canvasGridDensity,
      );
      snapshotRef.current = null;
    }
    setEditing(null);
    void (onCanceled ?? onApplied)();
  }

  function handleApply(preset: ThemePreset) {
    setOpenThemeActions(null);
    setThemeActionsMenuPosition(null);
    persistPreset(preset);
    void onApplied();
  }

  function handleApplyBuiltIn(theme: Theme) {
    setOpenThemeActions(null);
    setThemeActionsMenuPosition(null);
    resetThemeToDefaults(theme);
    void onApplied();
  }

  function handleDelete(id: string) {
    const wasActive = getActivePresetId() === id;
    const preset = presets.find((item) => item.id === id);
    deletePreset(id);
    setPresets(getPresets());
    if (wasActive) {
      resetThemeToDefaults(preset?.base ?? getStoredTheme());
      void onApplied();
    }
  }

  return (
    <SettingsModal
      title={editing ? (editing.name ? t("sharedModals.theme.editingTitle", { name: editing.name }) : t("sharedModals.theme.newThemeTitle")) : t("sharedModals.theme.title")}
      onClose={editing ? handleCancel : onClose}
    >
      {editing ? (
        <ThemeEditor initial={editing} onSave={handleSave} onCancel={handleCancel} />
      ) : (
        <>
          <div className="app-settings-modal-body">
            <div className="theme-manager-header">
              <div />
              <div className="theme-manager-actions">
                <button
                  className="codebook-icon-action theme-manager-add-button"
                  onClick={openNew}
                  aria-label={t("sharedModals.theme.newTheme")}
                  title={t("sharedModals.theme.newTheme")}
                >
                  <PlusIcon />
                </button>
              </div>
            </div>

            <div className="theme-preset-list">
              {(["light", "dark"] as Theme[]).map((baseTheme) => (
                <div key={`built-in-${baseTheme}`} className="theme-preset-row">
                  <div className="theme-preset-swatches theme-preset-swatches--preview">
                    <ThemePreviewThumbnail theme={baseTheme} />
                  </div>
                  <div className="theme-preset-info">
                    <span className="theme-preset-name">{baseTheme === "light" ? t("sharedModals.theme.light") : t("sharedModals.theme.dark")}</span>
                    <span className={`theme-preset-badge theme-preset-badge--${baseTheme}`}>
                      {t("sharedModals.theme.builtIn")}
                    </span>
                    <span className="theme-preset-meta">{t("sharedModals.theme.defaultTheme")}</span>
                  </div>
                  <div
                    className="theme-preset-actions"
                  >
                    <button
                      type="button"
                      className="snapshot-actions-trigger"
                      data-theme-actions-trigger="true"
                      onClick={(event) => openActionsMenu(event, `built-in-${baseTheme}`, 2)}
                      aria-label={t("sharedModals.theme.namedThemeActions", { name: baseTheme === "light" ? t("sharedModals.theme.light") : t("sharedModals.theme.dark") })}
                      aria-expanded={openThemeActions === `built-in-${baseTheme}`}
                      title={t("sharedModals.theme.themeActions")}
                    >
                      ...
                    </button>
                    {openThemeActions === `built-in-${baseTheme}` ? (
                      <div
                        ref={themeActionsMenuRef}
                        className="snapshot-actions-menu theme-preset-actions-menu"
                        style={themeActionsMenuPosition ?? undefined}
                        role="menu"
                      >
                        <button
                          type="button"
                          className="snapshot-actions-menu-item"
                          onClick={() => handleApplyBuiltIn(baseTheme)}
                          role="menuitem"
                        >
                          {t("common.apply")}
                        </button>
                        <button
                          type="button"
                          className="snapshot-actions-menu-item"
                          onClick={() => {
                            setOpenThemeActions(null);
                            setThemeActionsMenuPosition(null);
                            openNewFromBase(baseTheme);
                          }}
                          role="menuitem"
                        >
                          {t("common.customize")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}

              {presets.length === 0 ? (
                <div className="theme-manager-empty">
                  <p>{t("sharedModals.theme.emptyTitle")}</p>
                  <p>{t("sharedModals.theme.emptyBody")}</p>
                </div>
              ) : (
                presets.map((preset) => (
                  <div key={preset.id} className="theme-preset-row">
                    <div className="theme-preset-swatches theme-preset-swatches--preview">
                      <ThemePresetPreviewThumbnail preset={preset} />
                    </div>
                    <div className="theme-preset-info">
                      <span className="theme-preset-name">{preset.name || t("sharedModals.theme.untitled")}</span>
                      <span className={`theme-preset-badge theme-preset-badge--${preset.base}`}>
                        {preset.base}
                      </span>
                      <span className="theme-preset-meta">
                        {t("sharedModals.theme.presetMeta", { radius: preset.borderRadius, borderWidth: preset.borderWidth })}
                      </span>
                    </div>
                    <div
                      className="theme-preset-actions"
                    >
                      <button
                        type="button"
                        className="snapshot-actions-trigger"
                        data-theme-actions-trigger="true"
                        onClick={(event) => openActionsMenu(event, `preset-${preset.id}`, 3)}
                        aria-label={t("sharedModals.theme.namedThemeActions", { name: preset.name || t("sharedModals.theme.untitled") })}
                        aria-expanded={openThemeActions === `preset-${preset.id}`}
                        title={t("sharedModals.theme.themeActions")}
                      >
                        ...
                      </button>
                      {openThemeActions === `preset-${preset.id}` ? (
                        <div
                          ref={themeActionsMenuRef}
                          className="snapshot-actions-menu theme-preset-actions-menu"
                          style={themeActionsMenuPosition ?? undefined}
                          role="menu"
                        >
                          <button
                            type="button"
                            className="snapshot-actions-menu-item"
                            onClick={() => handleApply(preset)}
                            role="menuitem"
                          >
                            {t("common.apply")}
                          </button>
                          <button
                            type="button"
                            className="snapshot-actions-menu-item"
                            onClick={() => {
                              setOpenThemeActions(null);
                              setThemeActionsMenuPosition(null);
                              openEdit(preset);
                            }}
                            role="menuitem"
                          >
                            {t("common.edit")}
                          </button>
                          <button
                            type="button"
                            className="snapshot-actions-menu-item snapshot-actions-menu-item--danger"
                            onClick={() => {
                              setOpenThemeActions(null);
                              setThemeActionsMenuPosition(null);
                              handleDelete(preset.id);
                            }}
                            role="menuitem"
                          >
                            {t("common.delete")}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="app-settings-modal-footer">
            <span />
            <button className="btn btn--primary" onClick={onClose}>
              {t("common.done")}
            </button>
          </div>
        </>
      )}
    </SettingsModal>
  );
}
