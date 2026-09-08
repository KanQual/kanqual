import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";
import { useI18n } from "../i18n/provider";

type SettingsModalProps = {
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  subtitle?: ReactNode;
  modalClassName?: string;
  overlayClassName?: string;
  overlayStyle?: CSSProperties;
};

export function SettingsModalCloseButton({
  onClick,
  disabled = false,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();

  return (
    <button
      type="button"
      className="modal-close-icon"
      aria-label={t("common.close")}
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
  overlayClassName = "",
  overlayStyle,
}: SettingsModalProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const subtitleId = useId();
  const modalClasses = `modal app-settings-modal${modalClassName ? ` ${modalClassName}` : ""}`;
  const overlayClasses = `modal-overlay${overlayClassName ? ` ${overlayClassName}` : ""}`;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      if (!modalRef.current?.contains(document.activeElement)) {
        modalRef.current?.querySelector<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")?.focus();
      }
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || closeDisabled) return;
      const overlays = document.querySelectorAll(".modal-overlay");
      if (overlays[overlays.length - 1] !== overlayRef.current) return;
      event.preventDefault();
      onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeDisabled, onClose]);

  return (
    <div ref={overlayRef} className={overlayClasses} style={overlayStyle} onClick={() => !closeDisabled && onClose()}>
      <div
        ref={modalRef}
        className={modalClasses}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <SettingsModalCloseButton onClick={onClose} disabled={closeDisabled} />
        <div className="settings-section-header">
          <div>
            <h2 id={titleId} className="settings-section-title">{title}</h2>
            {subtitle ? <div id={subtitleId} className="settings-section-desc">{subtitle}</div> : null}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
