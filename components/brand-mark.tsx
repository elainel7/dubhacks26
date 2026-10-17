export function BrandMark({ className = "size-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <path
        d="M7 22.25h18"
        className="stroke-primary-foreground"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M13.2 21.15c1.5-4.5 3.8-6.9 7.8-7.9-2 2.4-1.6 4.5-.1 6-2.4.2-4.8.9-7.7 1.9z"
        className="fill-primary-foreground"
      />
      <circle cx="19.5" cy="13.5" r="0.8" className="fill-primary" />
    </svg>
  );
}
