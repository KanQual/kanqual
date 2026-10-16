import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { GraphSettingsIcon } from "./AppIcons";
import { useI18n } from "../i18n/provider";
import { CANVAS_ADVANCED_CONTROLS, DEFAULT_CANVAS_LAYOUT_SETTINGS, type CanvasLayoutSettings } from "../lib/canvasLayoutSettings";

export function CanvasGraphSettings({ settings, onChange, attributes, busy, onApply, itemSizeControls, customItemSizes }: {
  settings: CanvasLayoutSettings;
  onChange: (settings: CanvasLayoutSettings) => void;
  attributes: string[];
  busy: boolean;
  onApply: () => void;
  itemSizeControls?: ReactNode;
  customItemSizes?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState(0);
  const [maxHeight, setMaxHeight] = useState(480);
  const control = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const customized = customItemSizes || JSON.stringify(settings) !== JSON.stringify(DEFAULT_CANVAS_LAYOUT_SETTINGS);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !control.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const anchor = control.current?.getBoundingClientRect();
      const stage = control.current?.closest(".graph-canvas-canvas-stage")?.getBoundingClientRect();
      const x = anchor?.left ?? 0;
      const width = Math.min(320, window.innerWidth - 32);
      setLeft(Math.max(8 - x, Math.min(0, window.innerWidth - x - width - 8)));
      setMaxHeight(Math.max(0, Math.min(480, (anchor?.top ?? window.innerHeight) - Math.max(0, stage?.top ?? 0) - 20)));
    };
    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [open]);
  return <div ref={control} className="project-home-canvas-filter-control">
    <button ref={trigger} type="button" className={`btn ${customized ? "btn--primary" : "btn--ghost"}`}
      onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls={open ? id : undefined}
      title={t("projectCore.graph.settingsTitle")} aria-label={t("projectCore.graph.settingsTitle")}>
      <GraphSettingsIcon className="graph-canvas-canvas-control-icon" />
    </button>
    {open ? <div id={id} className="project-home-filter-drawer graph-settings-card" style={{ left, maxHeight }}
      role="region" aria-label={t("projectCore.graph.settingsTitle")}>
      <strong>{t("projectCore.graph.settingsTitle")}</strong>
      <p className="muted">{t("projectCore.graph.networkSettingsHint")}</p>
      <label className="graph-settings-field">
        <span>{t("projectCore.graph.groupBy")}</span>
        <select value={settings.groupBy} disabled={busy} onChange={event => onChange({ ...settings, groupBy: event.target.value })}>
          <option value="none">{t("projectCore.graph.groupNone")}</option>
          <option value="kind">{t("projectCore.graph.groupKind")}</option>
          <option value="type">{t("projectCore.graph.groupType")}</option>
          {attributes.length ? <optgroup label={t("projectCore.graph.groupAttributes")}>
            {attributes.map(name => <option key={name} value={`attribute:${name}`}>{name}</option>)}
          </optgroup> : null}
        </select>
      </label>
      <label className="graph-settings-field">
        <span>{t("projectCore.graph.spacing")}</span>
        <select value={settings.spacing} disabled={busy}
          onChange={event => onChange({ ...settings, spacing: event.target.value as CanvasLayoutSettings["spacing"] })}>
          <option value="compact">{t("projectCore.graph.spacingCompact")}</option>
          <option value="balanced">{t("projectCore.graph.spacingBalanced")}</option>
          <option value="spread">{t("projectCore.graph.spacingSpread")}</option>
        </select>
      </label>
      <label className="graph-settings-check">
        <span>{t("projectCore.graph.allowLabelRoom")}</span>
        <input type="checkbox" checked={settings.includeLabels} disabled={busy}
          onChange={event => onChange({ ...settings, includeLabels: event.target.checked })} />
      </label>

      {itemSizeControls ? <details className="graph-settings-section">
        <summary>{t("projectCore.graph.itemSizes")}</summary>
        {itemSizeControls}
      </details> : null}
      <details className="graph-settings-advanced">
        <summary>{t("projectCore.graph.advancedSettings")}</summary>
        <p className="muted">{t("projectCore.graph.advancedSettingsHint")}</p>
        {CANVAS_ADVANCED_CONTROLS.map(({ key, min, max, step, groupOnly }) => (
          <label key={key} className="graph-settings-field">
            <span className="graph-settings-range-label">
              <span>{t(`projectCore.graph.layoutControls.${key}.label`)}</span>
              <output htmlFor={`${id}-${key}`}>{settings[key]}</output>
            </span>
            <input id={`${id}-${key}`} type="range" min={min} max={max} step={step} value={settings[key]}
              aria-label={t(`projectCore.graph.layoutControls.${key}.label`)}
              aria-describedby={`${id}-${key}-hint`}
              disabled={busy || (groupOnly && settings.groupBy === "none")}
              onChange={event => onChange({ ...settings, [key]: Number(event.target.value) })} />
            <span id={`${id}-${key}-hint`} className="muted graph-settings-hint">{t(`projectCore.graph.layoutControls.${key}.hint`)}</span>
          </label>
        ))}
        <button type="button" className="btn btn--ghost graph-settings-reset" disabled={busy}
          onClick={() => {
            const next = { ...settings };
            for (const { key } of CANVAS_ADVANCED_CONTROLS) next[key] = DEFAULT_CANVAS_LAYOUT_SETTINGS[key];
            onChange(next);
          }}>{t("projectCore.graph.resetAdvancedSettings")}</button>
      </details>
      <button type="button" className="btn btn--primary graph-settings-apply" disabled={busy}
        onClick={() => { setOpen(false); onApply(); }}>{t("projectCore.graph.applyNetworkLayout")}</button>
    </div> : null}
  </div>;
}
