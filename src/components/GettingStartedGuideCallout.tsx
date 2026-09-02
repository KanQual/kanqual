import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowRightToLine } from "lucide-react";

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

  const content = collapsed ? (
    <button
      type="button"
      className="getting-started-guide-tab"
      onClick={() => setCollapsed(false)}
      aria-label={`Open guide: ${title}`}
      title={title}
    >
      Guide
    </button>
  ) : (
    <aside
      className={`getting-started-callout${spotlight ? " getting-started-spotlight-target getting-started-callout--spotlight" : ""}`}
      aria-live="polite"
      aria-label="Getting started guide"
    >
      <div className="getting-started-callout-header">
        <span>Guide</span>
        <button
          type="button"
          className="getting-started-callout-collapse"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse guide"
          title="Collapse guide"
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
            Exit guide
          </button>
        ) : null}
      </div>
    </aside>
  );

  return renderGuidePortal(content);
}
