import type { ReactNode } from "react";
import { useI18n } from "../i18n/provider";
import { SettingsModal } from "./SettingsModal";

type HelpModalProps = {
  title: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  lines?: ReactNode[];
  closeLabel?: ReactNode;
  showCloseAction?: boolean;
  modalClassName?: string;
  bodyClassName?: string;
};

export function HelpModal({
  title,
  onClose,
  children,
  lines,
  closeLabel,
  showCloseAction = true,
  modalClassName = "",
  bodyClassName = "app-settings-modal-body",
}: HelpModalProps) {
  const { t } = useI18n();
  const classes = `modal--help${modalClassName ? ` ${modalClassName}` : ""}`;

  return (
    <SettingsModal title={title} onClose={onClose} modalClassName={classes}>
      <div className={bodyClassName}>
        {lines?.map((line, index) => (
          <p className="supporting-copy" key={index}>{line}</p>
        ))}
        {children}
      </div>
      {showCloseAction ? (
        <div className="app-settings-modal-footer app-settings-modal-footer--actions-only">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {closeLabel ?? t("common.close")}
          </button>
        </div>
      ) : null}
    </SettingsModal>
  );
}
