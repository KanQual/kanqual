import type { ReactNode } from "react";

type SettingsModalProps = {
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
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
}: SettingsModalProps) {
  return (
    <div className="modal-overlay" onClick={() => !closeDisabled && onClose()}>
      <div className="modal app-settings-modal" onClick={(event) => event.stopPropagation()}>
        <SettingsModalCloseButton onClick={onClose} disabled={closeDisabled} />
        <div className="settings-section-header">
          <div>
            <h2 className="settings-section-title">{title}</h2>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
