export function FrontiMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect
        x="2"
        y="2"
        width="28"
        height="28"
        rx="4"
        stroke="#E20074"
        strokeWidth="2.5"
        fill="none"
      />
      <path
        d="M10 10h12v3H13.5v3H20v3h-6.5v5H10V10z"
        fill="#E20074"
      />
      <circle cx="26" cy="12" r="1.5" fill="#E20074" />
      <circle cx="28" cy="16" r="1.5" fill="#E20074" />
      <circle cx="26" cy="20" r="1.5" fill="#E20074" />
      <line x1="22" y1="12" x2="24.5" y2="12" stroke="#E20074" strokeWidth="1.5" />
      <line x1="22" y1="16" x2="26.5" y2="16" stroke="#E20074" strokeWidth="1.5" />
      <line x1="22" y1="20" x2="24.5" y2="20" stroke="#E20074" strokeWidth="1.5" />
    </svg>
  );
}

export function FrontiWordmark({ className }: { className?: string }) {
  return (
    <span className={`text-lg font-bold tracking-tight text-foreground ${className ?? ""}`}>
      Fronti
    </span>
  );
}
