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

/**
 * Team logo, falling back to initials on a flask-coloured tile.
 * `muted`: de-emphasised (e.g. the losing side) while keeping text contrast ≥ 4.5:1;
 * use it instead of lowering the opacity of a row that contains the avatar.
 */
export function TeamAvatar({
  name,
  logoUrl,
  side,
  size = "md",
  muted = false,
  className,
}: {
  name: string;
  logoUrl?: string | null;
  side?: TeamSide;
  size?: keyof typeof sizes;
  muted?: boolean;
  className?: string;
}) {
  const ring = muted
    ? "ring-border"
    : side === "home"
      ? "ring-team-home"
      : side === "away"
        ? "ring-team-away"
        : "ring-border";
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
        <img src={logoUrl} alt="" className={cn("size-full object-cover", muted && "opacity-60 grayscale")} />
      ) : (
        <span
          className={cn(
            "flex size-full items-center justify-center",
            // Tile tint ≤ 12 %: initials keep ≥ 4.5:1 against it (axe color-contrast).
            muted
              ? "text-muted-foreground"
              : side === "away"
                ? "bg-team-away/12 text-team-away"
                : side === "home"
                  ? "bg-team-home/12 text-team-home"
                  : "bg-primary/12 text-primary",
          )}
        >
          {initials(name)}
        </span>
      )}
    </span>
  );
}
