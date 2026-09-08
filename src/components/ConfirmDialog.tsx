import type { FormEvent, ReactNode } from "react";
import { useI18n } from "../i18n/provider";
import { SettingsModal } from "./SettingsModal";

type ConfirmDialogProps = {
  title: ReactNode;
  children?: ReactNode;
  warning?: ReactNode;
  error?: ReactNode;
  busy?: boolean;
  confirmDisabled?: boolean;
  confirmLabel: ReactNode;
  busyLabel?: ReactNode;
  cancelLabel?: ReactNode;
  tone?: "primary" | "danger";
  autoFocusConfirm?: boolean;
  modalClassName?: string;
  footerClassName?: string;
  onClose: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  title,
  children,
  warning,
  error,
  busy = false,
  confirmDisabled = false,
  confirmLabel,
  busyLabel,
  cancelLabel,
  tone = "primary",
  autoFocusConfirm = false,
  modalClassName = "",
  footerClassName = "app-settings-modal-footer app-settings-modal-footer--actions-only",
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useI18n();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy && !confirmDisabled) onConfirm();
  }

  return (
    <SettingsModal title={title} onClose={onClose} closeDisabled={busy} modalClassName={modalClassName}>
      <form onSubmit={submit}>
        <div className="app-settings-modal-body">
          {children}
          {warning ? <p className="modal-warning-text">{warning}</p> : null}
          {error ? <p className="auth-error">{error}</p> : null}
        </div>
        <div className={footerClassName}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {cancelLabel ?? t("common.cancel")}
          </button>
          <button
            type="submit"
            autoFocus={autoFocusConfirm}
            className={tone === "danger" ? "btn btn--danger" : "btn btn--primary"}
            disabled={busy || confirmDisabled}
          >
            {busy && busyLabel ? busyLabel : confirmLabel}
          </button>
        </div>
      </form>
    </SettingsModal>
  );
}
