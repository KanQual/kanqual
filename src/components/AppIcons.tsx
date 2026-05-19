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
