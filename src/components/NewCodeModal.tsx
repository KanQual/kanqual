import { useMemo, useState } from "react";
import { useI18n } from "../i18n/provider";
import { SettingsModal } from "./SettingsModal";

export interface CodeRow {
  id: string;
  label: string;
  color: string;
  description: string;
  parentId: string;
  parentLabel: string;
  createdByName: string;
  createdAt: string;
  sourcesCount: number;
}

function hexToHsl(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(5, Math.min(95, l)) / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hueDiff(h1: number, h2: number): number {
  const d = Math.abs(h1 - h2) % 360;
  return d > 180 ? 360 - d : d;
}

function colorDistance(hex1: string, hex2: string): number {
  try {
    const [h1, s1, l1] = hexToHsl(hex1);
    const [h2, s2, l2] = hexToHsl(hex2);
    return hueDiff(h1, h2) * 0.7 + Math.abs(s1 - s2) * 0.15 + Math.abs(l1 - l2) * 0.15;
  } catch { return 0; }
}

const TOP_LEVEL_PALETTE = [
  "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e",
  "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6",
  "#ec4899", "#f43f5e", "#10b981", "#0ea5e9", "#a855f7",
  "#64748b",
];

function getTopLevelSuggestions(existingColors: string[], count = 8): string[] {
  return [...TOP_LEVEL_PALETTE]
    .map((color) => ({
      color,
      score: existingColors.length === 0
        ? TOP_LEVEL_PALETTE.indexOf(color) * -1
        : Math.min(...existingColors.map((existing) => colorDistance(color, existing))),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, count)
    .map((entry) => entry.color);
}

function getChildSuggestions(parentColor: string, count = 8): string[] {
  if (!parentColor?.startsWith("#")) return [];
  const [h, s, l] = hexToHsl(parentColor);
  return [
    hslToHex(h, s, Math.min(l + 22, 85)),
    hslToHex(h, s, Math.max(l - 22, 15)),
    hslToHex(h, Math.min(s + 18, 95), l),
    hslToHex(h, Math.max(s - 18, 25), l),
    hslToHex((h + 18) % 360, s, l),
    hslToHex((h - 18 + 360) % 360, s, l),
    hslToHex((h + 30) % 360, s, Math.min(l + 10, 85)),
    hslToHex((h - 30 + 360) % 360, s, Math.max(l - 10, 15)),
  ].slice(0, count);
}

function ColorSuggestions({
  suggestions,
  selected,
  onSelect,
}: {
  suggestions: string[];
  selected: string;
  onSelect: (color: string) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="code-color-suggestions">
      {suggestions.map((color) => (
        <button
          key={color}
          type="button"
          className={`code-suggestion-swatch${selected === color ? " code-suggestion-swatch--active" : ""}`}
          style={{ background: color }}
          onClick={() => onSelect(color)}
          title={color}
        />
      ))}
    </div>
  );
}

export function NewCodeModal({
  allCodes,
  title,
  submitLabel,
  initialLabel = "",
  initialDescription = "",
  initialColor = "#6366f1",
  initialParentId = "",
  excludeCodeId,
  onSubmit,
  onDone,
  onClose,
}: {
  allCodes: CodeRow[];
  title?: string;
  submitLabel?: string;
  initialLabel?: string;
  initialDescription?: string;
  initialColor?: string;
  initialParentId?: string;
  excludeCodeId?: string;
  onSubmit: (payload: { label: string; color: string; description: string; parentId?: string }) => Promise<void>;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const resolvedTitle = title ?? t("projectCodebook.modal.newTitle");
  const resolvedSubmitLabel = submitLabel ?? t("projectCodebook.modal.createCode");
  const [label, setLabel] = useState(initialLabel);
  const [desc, setDesc] = useState(initialDescription);
  const [color, setColor] = useState(initialColor);
  const [parentId, setParentId] = useState(initialParentId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableCodes = allCodes.filter((code) => code.id !== excludeCodeId);
  const sortedParentCodeOptions = useMemo(() => (
    [...availableCodes].sort((left, right) => {
      const leftLabel = left.parentLabel ? `${left.parentLabel} > ${left.label}` : left.label;
      const rightLabel = right.parentLabel ? `${right.parentLabel} > ${right.label}` : right.label;
      return leftLabel.localeCompare(rightLabel, undefined, { sensitivity: "base" });
    })
  ), [availableCodes]);
  const parentCode = allCodes.find((code) => code.id === parentId);

  const colorSuggestions = useMemo(() => {
    if (parentId && parentCode) {
      return getChildSuggestions(parentCode.color);
    }
    const topLevelColors = availableCodes.filter((code) => !code.parentId).map((code) => code.color);
    return getTopLevelSuggestions(topLevelColors);
  }, [parentId, parentCode, availableCodes]);

  function handleParentChange(nextParentId: string) {
    setParentId(nextParentId);

    const nextParentCode = allCodes.find((code) => code.id === nextParentId);
    const nextSuggestions = nextParentId && nextParentCode
      ? getChildSuggestions(nextParentCode.color)
      : getTopLevelSuggestions(availableCodes.filter((code) => !code.parentId).map((code) => code.color));

    if (nextSuggestions.length > 0) {
      setColor(nextSuggestions[0]);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!label.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await onSubmit({
        label: label.trim(),
        color,
        description: desc,
        parentId: parentId || undefined,
      });
      onDone();
    } catch (submitError) {
      const fieldErrors = (submitError as { data?: { data?: Record<string, { message?: string }> } }).data?.data;
      if (fieldErrors && Object.keys(fieldErrors).length > 0) {
        setError(Object.entries(fieldErrors).map(([field, value]) => `${field}: ${value?.message ?? t("projectCodebook.errors.invalidField")}`).join(" - "));
      } else {
        setError(submitError instanceof Error ? submitError.message : t("projectCodebook.errors.createFailed"));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <SettingsModal title={resolvedTitle} onClose={onClose} closeDisabled={loading}>
      <form className="form" onSubmit={handleSubmit}>
        <div className="app-settings-modal-body">
          <label className="form-label">
            {t("projectCodebook.modal.codeName")}
            <input
              className="form-input"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="e.g. Resilience"
              required
              autoFocus
            />
          </label>

          <label className="form-label">
            {t("projectCodebook.detail.description")}
            <textarea
              className="form-input code-desc-textarea"
              value={desc}
              onChange={(event) => setDesc(event.target.value)}
              placeholder={t("projectCodebook.modal.optionalDescription")}
              rows={3}
            />
          </label>

          <label className="form-label">
            {t("projectCodebook.modal.parentCode")}
            <select
              className="form-input"
              value={parentId}
              onChange={(event) => handleParentChange(event.target.value)}
            >
              <option value="">{t("projectCodebook.modal.topLevelOption")}</option>
              {sortedParentCodeOptions.map((code) => (
                <option key={code.id} value={code.id}>
                  {code.parentLabel ? `${code.parentLabel} > ${code.label}` : code.label}
                </option>
              ))}
            </select>
          </label>

          <label className="form-label">
            {t("projectCodebook.detail.color")}
            <div className="code-color-row" style={{ marginTop: 6 }}>
              <input
                type="color"
                className="code-color-input"
                value={color}
                onChange={(event) => setColor(event.target.value)}
              />
              <span className="code-color-hex">{color}</span>
            </div>
            <ColorSuggestions
              suggestions={colorSuggestions}
              selected={color}
              onSelect={setColor}
            />
            <p className="code-color-hint">
              {parentId
                ? t("projectCodebook.modal.parentColorHint")
                : t("projectCodebook.modal.distinctColorHint")}
            </p>
          </label>

          {error && <p className="auth-error">{error}</p>}
        </div>
        <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
          <button type="button" className="btn" onClick={onClose} disabled={loading}>{t("common.cancel")}</button>
          <button type="submit" className="btn btn--primary" disabled={loading || !label.trim()}>
            {loading ? t("projectCodebook.statuses.saving") : resolvedSubmitLabel}
          </button>
        </div>
      </form>
    </SettingsModal>
  );
}
