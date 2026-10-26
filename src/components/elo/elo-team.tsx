import { teamLabel } from "@/lib/elo-format";
import { sideLabel } from "@/lib/i18n/de-elo";
import type { EloSideKey } from "@/lib/elo-live-types";
import { cn } from "@/lib/utils";
import { AvatarStack, type AvatarSize } from "./player-avatar";

/**
 * "A" / "B" chip: the side colour is always paired with its letter. `decorative` when "Team A" is
 * already written next to it (otherwise screen readers would hear it twice).
 */
export function SideTag({
  side,
  decorative = false,
  className,
}: {
  side: EloSideKey;
  decorative?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden={decorative || undefined}
      className={cn(
        "font-display inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-base leading-none",
        side === "A" ? "bg-team-home text-team-home-foreground" : "bg-team-away text-team-away-foreground",
        className,
      )}
    >
      {!decorative && <span className="sr-only">{sideLabel[side]}</span>}
      <span aria-hidden="true">{side}</span>
    </span>
  );
}

/** One temporary team in a single line: side tag, avatars, names. */
export function EloTeamLine({
  side,
  players,
  size = "sm",
  className,
  nameClassName,
}: {
  side: EloSideKey;
  players: readonly { userId: string; displayName: string }[];
  size?: AvatarSize;
  className?: string;
  nameClassName?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <SideTag side={side} />
      <AvatarStack players={players} side={side} size={size} />
      <span className={cn("min-w-0 leading-tight font-semibold break-words", nameClassName)}>
        {teamLabel(players.map((p) => p.displayName))}
      </span>
    </div>
  );
}

/** Thin "vs" divider between two team lines (spoken as "gegen"). */
export function VersusDivider() {
  return (
    <div className="flex items-center gap-3">
      <span className="bg-border h-px flex-1" aria-hidden="true" />
      <span className="font-display text-muted-foreground text-sm">
        <span aria-hidden="true">vs</span>
        <span className="sr-only">gegen</span>
      </span>
      <span className="bg-border h-px flex-1" aria-hidden="true" />
    </div>
  );
}
