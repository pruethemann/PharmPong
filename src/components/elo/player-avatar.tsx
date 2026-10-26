import { initials } from "@/components/pp/team-avatar";
import { avatarTone } from "@/lib/elo-format";
import type { EloSideKey } from "@/lib/elo-live-types";
import { cn } from "@/lib/utils";

// Tint ≤ 12 %: the initials keep ≥ 4.5:1 against it (same rule as TeamAvatar).
const TONES = {
  1: "bg-chart-1/12 text-chart-1",
  2: "bg-chart-2/12 text-chart-2",
  3: "bg-chart-3/12 text-chart-3",
  4: "bg-chart-4/12 text-chart-4",
  5: "bg-chart-5/12 text-chart-5",
} as const;

const SIZES = {
  xs: "size-7 text-[0.7rem]",
  sm: "size-9 text-xs",
  md: "size-11 text-sm",
  lg: "size-14 text-lg",
  xl: "size-20 text-2xl",
} as const;

export type AvatarSize = keyof typeof SIZES;

/**
 * Round initials avatar for a person (teams use the square TeamAvatar). Decorative: the name is
 * always shown next to it. The ring marks the side in a match (A cyan, B magenta).
 */
export function PlayerAvatar({
  userId,
  name,
  side,
  size = "md",
  className,
}: {
  userId: string;
  name: string;
  side?: EloSideKey | null;
  size?: AvatarSize;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "bg-card font-display inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ring-2",
        side === "A" ? "ring-team-home" : side === "B" ? "ring-team-away" : "ring-border",
        SIZES[size],
        className,
      )}
    >
      <span className={cn("flex size-full items-center justify-center", TONES[avatarTone(userId)])}>
        {initials(name)}
      </span>
    </span>
  );
}

/** Overlapping avatars of one temporary team. */
export function AvatarStack({
  players,
  side,
  size = "sm",
  className,
}: {
  players: readonly { userId: string; displayName: string }[];
  side?: EloSideKey | null;
  size?: AvatarSize;
  className?: string;
}) {
  return (
    <span className={cn("flex shrink-0 -space-x-2", className)} aria-hidden="true">
      {players.map((p) => (
        <PlayerAvatar key={p.userId} userId={p.userId} name={p.displayName} side={side} size={size} />
      ))}
    </span>
  );
}
