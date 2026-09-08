export type ModalTabOption<T extends string> = {
  value: T;
  label: string;
};

export function ModalTabSelector<T extends string>(props: {
  value: T;
  options: Array<ModalTabOption<T>>;
  ariaLabel: string;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={props.className ?? "segmented-control modal-segmented-control"} role="tablist" aria-label={props.ariaLabel}>
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={props.value === option.value}
          className={`segmented-control-option ${props.value === option.value ? "segmented-control-option--active" : ""}`}
          onClick={() => props.onChange(option.value)}
          disabled={props.disabled}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
