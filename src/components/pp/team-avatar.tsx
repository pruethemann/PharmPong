import { cn } from "@/lib/utils";

export type TeamSide = "home" | "away";

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

const sizes = {
  sm: "size-8 text-xs",
  md: "size-12 text-base",
  lg: "size-16 text-xl",
  xl: "size-28 text-4xl",
};

/** Team logo, falling back to initials on a flask-coloured tile. */
export function TeamAvatar({
  name,
  logoUrl,
  side,
  size = "md",
  className,
}: {
  name: string;
  logoUrl?: string | null;
  side?: TeamSide;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const ring = side === "home" ? "ring-team-home" : side === "away" ? "ring-team-away" : "ring-border";
  return (
    <span
      className={cn(
        "bg-muted font-display relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-2xl ring-2",
        ring,
        sizes[size],
        className,
      )}
      aria-hidden="true"
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- served by our own logo route
        <img src={logoUrl} alt="" className="size-full object-cover" />
      ) : (
        <span
          className={cn(
            "flex size-full items-center justify-center",
            side === "away"
              ? "bg-team-away/20 text-team-away"
              : side === "home"
                ? "bg-team-home/20 text-team-home"
                : "bg-primary/15 text-primary",
          )}
        >
          {initials(name)}
        </span>
      )}
    </span>
  );
}
