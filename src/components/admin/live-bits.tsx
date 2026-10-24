"use client";

import { CircleSlash, MapPin, Play, Sparkles, Trophy } from "lucide-react";
import { TeamAvatar, type TeamSide } from "@/components/pp/team-avatar";
import { sourceLabel } from "@/lib/live-labels";
import { tableStateLabel, type TableStateKey } from "@/lib/i18n/de";
import type { LiveMatch, LiveTeam } from "@/lib/live-types";
import { cn } from "@/lib/utils";

export type TeamIndex = Map<string, LiveTeam>;

export function indexTeams(teams: LiveTeam[]): TeamIndex {
  return new Map(teams.map((t) => [t.id, t]));
}

/** One side of a match: avatar + name (truncating) or the bracket placeholder. */
export function TeamLine({
  teams,
  teamId,
  source,
  side,
  cups,
  winner,
  size = "md",
}: {
  teams: TeamIndex;
  teamId: string | null;
  source?: string | null;
  side: TeamSide;
  cups?: number | null;
  winner?: boolean;
  size?: "sm" | "md";
}) {
  const team = teamId ? teams.get(teamId) : null;
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {team ? (
        <TeamAvatar name={team.name} logoUrl={team.logoUrl} side={side} size="sm" />
      ) : (
        <span
          className="border-border size-8 shrink-0 rounded-2xl border-2 border-dashed"
          aria-hidden="true"
        />
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          size === "md" ? "text-base" : "text-sm",
          team ? "font-semibold" : "text-muted-foreground italic",
          winner && "text-gold",
        )}
      >
        <span className="sr-only">{side === "home" ? "Team A: " : "Team B: "}</span>
        {team ? team.name : sourceLabel(source)}
        {winner && <span className="sr-only"> (Sieger)</span>}
      </span>
      {winner && <Trophy className="text-gold size-4 shrink-0" aria-hidden="true" />}
      {cups != null && (
        <span className="font-display tabular w-6 shrink-0 text-right text-xl">
          {cups}
          <span className="sr-only"> Becher übrig</span>
        </span>
      )}
    </div>
  );
}

const TABLE_STATE_ICON: Record<TableStateKey, typeof Play> = {
  AVAILABLE: Sparkles,
  RESERVED: MapPin,
  IN_PROGRESS: Play,
  DISABLED: CircleSlash,
};

const TABLE_STATE_TONE: Record<TableStateKey, string> = {
  AVAILABLE: "border-success/60 bg-success/10 text-success",
  RESERVED: "border-status-assigned/60 bg-status-assigned/10 text-status-assigned",
  IN_PROGRESS: "border-status-live/70 bg-status-live/15 text-status-live",
  DISABLED: "border-destructive/60 bg-destructive/10 text-destructive",
};

/** Table state: icon + text + colour. */
export function TableStatePill({ state, className }: { state: TableStateKey; className?: string }) {
  const Icon = TABLE_STATE_ICON[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-semibold whitespace-nowrap",
        TABLE_STATE_TONE[state],
        className,
      )}
    >
      <Icon className="size-[1em]" aria-hidden="true" />
      {tableStateLabel[state]}
    </span>
  );
}

export function matchTitle(m: LiveMatch, teams: TeamIndex): string {
  const name = (id: string | null, src: string | null) =>
    id ? (teams.get(id)?.name ?? "?") : sourceLabel(src);
  return `${m.code}: ${name(m.homeTeamId, m.homeSource)} vs ${name(m.awayTeamId, m.awaySource)}`;
}
