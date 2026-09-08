import type { ReactNode } from "react";
import { ArrowLeftIcon, HelpIcon } from "./AppIcons";

interface ViewHeaderAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}

interface ViewHeaderProps {
  title: ReactNode;
  back?: ViewHeaderAction;
  help?: ViewHeaderAction;
  actions?: ReactNode;
  className?: string;
  titleClassName?: string;
}

export function ViewHeader({
  title,
  back,
  help,
  actions,
  className = "view-header",
  titleClassName = "view-title-row",
}: ViewHeaderProps) {
  return (
    <header className={className}>
      <div className={titleClassName}>
        {back ? (
          <button
            type="button"
            className="view-header-back-button"
            onClick={back.onClick}
            disabled={back.disabled}
            title={back.title ?? back.label}
            aria-label={back.label}
          >
            <ArrowLeftIcon className="view-header-back-icon" />
          </button>
        ) : null}
        <h1>{title}</h1>
        {help ? (
          <button
            type="button"
            className="view-header-help-button"
            onClick={help.onClick}
            disabled={help.disabled}
            title={help.title ?? help.label}
            aria-label={help.label}
          >
            <HelpIcon className="view-header-help-icon" />
          </button>
        ) : null}
      </div>
      {actions}
    </header>
  );
}
