import type { ReactNode } from "react";

export type SettingsOverviewCardTone = "default" | "network" | "ai" | "admin";

export function SettingsOverviewCard({
  title,
  description,
  icon,
  compact = false,
  tone = "default",
  className,
  disabled = false,
  ariaLabel,
  tooltip,
  onActivate,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
  tone?: SettingsOverviewCardTone;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  tooltip?: string;
  onActivate: () => void;
}) {
  return (
    <button
      type="button"
      className={[
        "app-settings-overview-card",
        compact ? "app-settings-overview-card--compact" : "",
        `app-settings-overview-card--${tone}`,
        className,
      ].filter(Boolean).join(" ")}
      disabled={disabled}
      aria-label={ariaLabel}
      title={tooltip}
      onClick={onActivate}
    >
      {compact && icon ? (
        <span className="app-settings-overview-card-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <h3>{title}</h3>
      {!compact && description ? <p>{description}</p> : null}
    </button>
  );
}

export function SettingsOverviewSection({
  heading,
  compact = false,
  className,
  children,
}: {
  heading?: ReactNode;
  compact?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={[
        "app-settings-overview-section",
        compact ? "app-settings-overview-section--compact" : "",
        className,
      ].filter(Boolean).join(" ")}
    >
      {heading ? (
        <div className="app-settings-overview-section-header">
          <p className="app-settings-overview-section-heading">{heading}</p>
        </div>
      ) : null}
      <div className={[
        "app-settings-overview-grid",
        compact ? "app-settings-overview-grid--compact" : "",
      ].filter(Boolean).join(" ")}>
        {children}
      </div>
    </section>
  );
}
