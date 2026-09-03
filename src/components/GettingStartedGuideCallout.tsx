import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowRightToLine } from "lucide-react";
import { useI18n } from "../i18n/provider";

function renderGuidePortal(content: ReactNode) {
  if (typeof document !== "undefined" && document.body) {
    return createPortal(content, document.body);
  }

  return content;
}

export function GettingStartedSpotlightOverlay() {
  return renderGuidePortal(<div className="getting-started-spotlight-overlay" aria-hidden="true" />);
}

export function GettingStartedGuideCallout({
  title,
  children,
  onDismiss,
  actions,
  spotlight = false,
}: {
  title: string;
  children: ReactNode;
  onDismiss?: () => void;
  actions?: ReactNode;
  spotlight?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const { t } = useI18n();

  const content = collapsed ? (
    <button
      type="button"
      className="getting-started-guide-tab"
      onClick={() => setCollapsed(false)}
      aria-label={t("app.gettingStarted.openGuide", { title })}
      title={title}
    >
      {t("app.gettingStarted.guide")}
    </button>
  ) : (
    <aside
      className={`getting-started-callout${spotlight ? " getting-started-spotlight-target getting-started-callout--spotlight" : ""}`}
      aria-live="polite"
      aria-label={t("app.gettingStarted.guideAria")}
    >
      <div className="getting-started-callout-header">
        <span>{t("app.gettingStarted.guide")}</span>
        <button
          type="button"
          className="getting-started-callout-collapse"
          onClick={() => setCollapsed(true)}
          aria-label={t("app.gettingStarted.collapseGuide")}
          title={t("app.gettingStarted.collapseGuide")}
        >
          <ArrowRightToLine
            aria-hidden="true"
            className="getting-started-callout-collapse-icon"
            focusable="false"
          />
        </button>
      </div>
      <div className="getting-started-callout-body">
        <h2>{title}</h2>
        <div className="getting-started-callout-copy">{children}</div>
      </div>
      <div className="getting-started-callout-actions">
        {actions}
        {onDismiss ? (
          <button type="button" className="btn" onClick={onDismiss}>
            {t("app.gettingStarted.exitGuide")}
          </button>
        ) : null}
      </div>
    </aside>
  );

  return renderGuidePortal(content);
}
