import { LOCALE_LABELS, SUPPORTED_LOCALES } from "../i18n";
import { useI18n } from "../i18n/provider";
import { SettingsModal } from "./SettingsModal";

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export function LanguageSettingsModal({
  title,
  label,
  locale,
  onChange,
  onClose,
}: {
  title: string;
  label?: string;
  locale: SupportedLocale;
  onChange: (locale: SupportedLocale) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const resolvedLabel = label ?? t("appSettings.language.label");

  return (
    <SettingsModal title={title} onClose={onClose}>
      <div className="app-settings-modal-body">
        <section className="app-settings-modal-section">
          <div className="app-settings-modal-section-header app-settings-modal-section-header--default">
            <h3>{title}</h3>
          </div>
          <div className="app-settings-modal-section-body">
            <div className="settings-row settings-row--centered">
              <div className="settings-row-label">{resolvedLabel}</div>
              <select
                className="form-input"
                style={{ width: "max-content", maxWidth: "100%" }}
                value={locale}
                onChange={(event) => onChange(event.target.value as SupportedLocale)}
              >
                {SUPPORTED_LOCALES.map((option) => (
                  <option key={option} value={option}>{LOCALE_LABELS[option]}</option>
                ))}
              </select>
            </div>
          </div>
        </section>
      </div>
      <div className="app-settings-modal-footer">
        <span />
        <button type="button" className="btn btn--primary" onClick={onClose}>{t("common.done")}</button>
      </div>
    </SettingsModal>
  );
}
