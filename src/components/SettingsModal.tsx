import type { CSSProperties, ReactNode } from "react";

type SettingsModalProps = {
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  subtitle?: ReactNode;
  modalClassName?: string;
  overlayStyle?: CSSProperties;
};

export function SettingsModalCloseButton({
  onClick,
  disabled = false,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="modal-close-icon"
      aria-label="Close"
      onClick={onClick}
      disabled={disabled}
    >
      X
    </button>
  );
}

export function SettingsModal({
  title,
  children,
  onClose,
  closeDisabled = false,
  subtitle,
  modalClassName = "",
  overlayStyle,
}: SettingsModalProps) {
  const modalClasses = `modal app-settings-modal${modalClassName ? ` ${modalClassName}` : ""}`;

  return (
    <div className="modal-overlay" style={overlayStyle} onClick={() => !closeDisabled && onClose()}>
      <div className={modalClasses} onClick={(event) => event.stopPropagation()}>
        <SettingsModalCloseButton onClick={onClose} disabled={closeDisabled} />
        <div className="settings-section-header">
          <div>
            <h2 className="settings-section-title">{title}</h2>
            {subtitle ? <div className="settings-section-desc">{subtitle}</div> : null}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
