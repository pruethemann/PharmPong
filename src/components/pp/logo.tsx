import { cn } from "@/lib/utils";

/** Erlenmeyer flask with a ping-pong ball and a molecule bond: the PharmaPong mark. */
export function LogoMark({ className, title = "PharmaPong" }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("size-10 shrink-0", className)}
      {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
    >
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id="pp-liquid" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="var(--primary)" />
          <stop offset="1" stopColor="var(--team-away)" />
        </linearGradient>
      </defs>
      <path
        d="M24 6h16M27 6v16L12 50a6 6 0 0 0 5.3 9h29.4A6 6 0 0 0 52 50L37 22V6"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M17.5 42h29l4.6 8.6A3.6 3.6 0 0 1 48 56H16a3.6 3.6 0 0 1-3.1-5.4Z" fill="url(#pp-liquid)" />
      <circle cx="32" cy="33" r="6.5" fill="var(--foreground)" stroke="var(--background)" strokeWidth="2" />
      <circle cx="45" cy="14" r="3" fill="var(--accent)" />
      <circle cx="54" cy="8" r="2.2" fill="var(--accent)" />
      <path d="M47.4 12.4l4.6-3" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "xl" }) {
  const text = { sm: "text-xl", md: "text-2xl", xl: "text-5xl sm:text-7xl" }[size];
  const mark = { sm: "size-7", md: "size-9", xl: "size-16 sm:size-24" }[size];
  return (
    <span className={cn("text-foreground inline-flex items-center gap-2", className)}>
      <LogoMark className={mark} title="" />
      <span className={cn("font-display leading-none", text)}>
        Pharma<span className="text-primary">Pong</span>
      </span>
    </span>
  );
}
