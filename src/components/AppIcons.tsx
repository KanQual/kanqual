type IconProps = {
  className?: string;
};

export function HelpIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 48 48"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M22 36h4v-4h-4zm2-32C12.96 4 4 12.96 4 24s8.96 20 20 20 20-8.96 20-20S35.04 4 24 4m0 36c-8.82 0-16-7.18-16-16S15.18 8 24 8s16 7.18 16 16-7.18 16-16 16m0-28c-4.42 0-8 3.58-8 8h4c0-2.2 1.8-4 4-4s4 1.8 4 4c0 4-6 3.5-6 10h4c0-4.5 6-5 6-10 0-4.42-3.58-8-8-8"
      />
    </svg>
  );
}

export function ComputerIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 48 48"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M8 32h32V10H8zm18 4v4h8v4H14v-4h8v-4H5.984A2 2 0 0 1 4 33.986V8.014C4 6.902 4.91 6 5.984 6h36.032C43.112 6 44 6.898 44 8.014v25.972C44 35.098 43.09 36 42.016 36z"
      />
    </svg>
  );
}

export function NetworkIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 48 48"
      focusable="false"
    >
      <g transform="translate(0 0) scale(1.5)">
        <path
          fill="currentColor"
          d="M17 17h5.142a4 4 0 1 0 0-2H17V7h5.142a4 4 0 1 0 0-2H17a2 2 0 0 0-2 2v8H9.858a4 4 0 1 0 0 2H15v8a2 2 0 0 0 2 2h5.142a4 4 0 1 0 0-2H17zm9-3a2 2 0 1 1-2 2 2 2 0 0 1 2-2m0-10a2 2 0 1 1-2 2 2 2 0 0 1 2-2M6 18a2 2 0 1 1 2-2 2 2 0 0 1-2 2m20 6a2 2 0 1 1-2 2 2 2 0 0 1 2-2"
        />
      </g>
    </svg>
  );
}

export function CollaborationIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 48 48"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M16 20a6 6 0 1 0-6-6 6 6 0 0 0 6 6m16 0a6 6 0 1 0-6-6 6 6 0 0 0 6 6M16 24c-6.08 0-11 3.58-11 8v2h22v-2c0-4.42-4.92-8-11-8m16 0c-1.58 0-3.08.24-4.42.68A10.16 10.16 0 0 1 31 32v2h12v-2c0-4.42-4.92-8-11-8"
      />
    </svg>
  );
}

export function AiAssistIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 48 48"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M24 4l3.64 11.08L39 18.72l-11.36 3.64L24 34l-3.64-11.64L9 18.72l11.36-3.64zM11 30l1.82 5.18L18 37l-5.18 1.82L11 44l-1.82-5.18L4 37l5.18-1.82zm28 2l1.44 4.56L45 38l-4.56 1.44L39 44l-1.44-4.56L33 38l4.56-1.44z"
      />
    </svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"
      />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z"
      />
    </svg>
  );
}

export function LogoutIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M5 5h7v2H7v10h5v2H5zm10.6 3.4L20.2 13l-4.6 4.6-1.4-1.4 2.2-2.2H10v-2h6.4l-2.2-2.2z"
      />
    </svg>
  );
}

export function DownloadIcon({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M11 4h2v8.2l3.1-3.1 1.4 1.4L12 16l-5.5-5.5 1.4-1.4 3.1 3.1zM5 18h14v2H5z"
      />
    </svg>
  );
}
