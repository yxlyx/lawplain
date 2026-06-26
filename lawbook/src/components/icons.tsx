type IconProps = { className?: string };

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function SearchIcon({ className }: IconProps) {
  return (
    <svg className={className} aria-hidden="true" {...base}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function XIcon({ className }: IconProps) {
  return (
    <svg className={className} aria-hidden="true" {...base}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function ArrowLeftIcon({ className }: IconProps) {
  return (
    <svg className={className} aria-hidden="true" {...base}>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}

export function ScrollIcon({ className }: IconProps) {
  return (
    <svg className={className} aria-hidden="true" {...base}>
      <path d="M8 21h8a3 3 0 0 0 3-3V6a3 3 0 0 0-3-3H6a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h11" />
      <path d="M8 7v11a3 3 0 0 1-3 3v0a3 3 0 0 1-3-3v-1h6" />
      <path d="M12 11h4M12 15h4" />
    </svg>
  );
}

export function ExternalLinkIcon({ className }: IconProps) {
  return (
    <svg className={className} aria-hidden="true" {...base}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

export function BookIcon({ className }: IconProps) {
  return (
    <svg className={className} aria-hidden="true" {...base}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

export function SparkleIcon({ className }: IconProps) {
  return (
    <svg className={className} aria-hidden="true" {...base}>
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" />
      <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z" />
    </svg>
  );
}

export function ArrowUpIcon({ className }: IconProps) {
  return (
    <svg className={className} aria-hidden="true" {...base}>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

export function StopIcon({ className }: IconProps) {
  return (
    <svg className={className} aria-hidden="true" {...base}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

export function CopyIcon({ className }: IconProps) {
  return (
    <svg className={className} aria-hidden="true" {...base}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg className={className} aria-hidden="true" {...base}>
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

export function LinkIcon({ className }: IconProps) {
  return (
    <svg className={className} aria-hidden="true" {...base}>
      <path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" />
      <path d="M14 11a5 5 0 0 0-7.1-.1l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1" />
    </svg>
  );
}

export function BookmarkIcon({ className }: IconProps) {
  return (
    <svg className={className} aria-hidden="true" {...base}>
      <path d="M6 4.5A2.5 2.5 0 0 1 8.5 2h7A2.5 2.5 0 0 1 18 4.5V21l-6-3.5L6 21z" />
    </svg>
  );
}

export function HighlighterIcon({ className }: IconProps) {
  return (
    <svg className={className} aria-hidden="true" {...base}>
      <path d="m4 20 4.5-1 9.8-9.8a2.1 2.1 0 0 0 0-3L16.8 4.7a2.1 2.1 0 0 0-3 0L4 14.5z" />
      <path d="m13 6 5 5" />
      <path d="M4 20h16" />
    </svg>
  );
}
